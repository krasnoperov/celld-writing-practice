import { httpError, json } from "./http.js";
import {
  createPolarCheckout,
  createPolarPortal,
  fetchPolarSubscription,
  githubIdFromPolarEvent,
  normalizePolarEvent,
  verifyPolarWebhook,
} from "./polar.js";

export const MAX_POLAR_WEBHOOK_BYTES = 256 * 1024;

export async function readLimitedWebhookBody(request, limit = MAX_POLAR_WEBHOOK_BYTES) {
  const declared = request.headers.get("Content-Length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > limit) {
    throw httpError(413, "Polar webhook body is too large");
  }
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) {
      await reader.cancel().catch(() => {});
      throw httpError(413, "Polar webhook body is too large");
    }
    chunks.push(value);
  }

  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

function accountStub(env, userId) {
  return env.ACCOUNTS.get(env.ACCOUNTS.idFromName(`github:${userId}`));
}

function accountHeaders(userId, body = false) {
  return {
    "X-Account-User-ID": String(userId),
    ...(body ? { "Content-Type": "application/json" } : {}),
  };
}

async function accountRequest(env, userId, pathname, init = {}) {
  const response = await accountStub(env, userId).fetch(new Request(`http://account${pathname}`, {
    ...init,
    headers: { ...accountHeaders(userId, init.body !== undefined), ...init.headers },
  }));
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.error || payload.reason || "Account operation failed"), { status: response.status, payload });
  return payload;
}

export function isAdminUser(user, env) {
  const admins = (env.ADMIN_GITHUB_IDS || "").split(",").map((value) => value.trim()).filter(Boolean);
  return admins.includes(String(user?.id || ""));
}

export async function deleteAccountCell(env, userId) {
  return accountRequest(env, userId, "/internal/delete", { method: "POST", body: JSON.stringify({}) });
}

export async function registerAccount(env, user) {
  return accountRequest(env, user.id, "/internal/profile", {
    method: "POST",
    body: JSON.stringify({ login: user.login, avatarUrl: user.avatarUrl }),
  });
}

export async function billingStatus(env, user) {
  return accountRequest(env, user.id, `/internal/status?admin=${isAdminUser(user, env)}`);
}

export async function handleBilling(request, env, user) {
  const url = new URL(request.url);
  try {
    if (request.method === "GET" && url.pathname === "/api/billing/status") {
      return json(await billingStatus(env, user));
    }

    if (request.method === "POST" && url.pathname === "/api/billing/checkout") {
      const status = await billingStatus(env, user);
      if (status.entitled && !status.admin) return json({ error: "This account already has access" }, 409);
      return json({ url: await createPolarCheckout(env, user, request) });
    }

    if (request.method === "POST" && url.pathname === "/api/billing/portal") {
      return json({ url: await createPolarPortal(env, user, request) });
    }

    if (request.method === "POST" && url.pathname === "/api/billing/sync") {
      const event = await fetchPolarSubscription(env, user.id);
      if (event) await accountRequest(env, user.id, "/internal/polar-event", { method: "POST", body: JSON.stringify(event) });
      return json(await billingStatus(env, user));
    }

    return json({ error: "Route not found" }, 404);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, error.status || 400);
  }
}

export async function handlePolarWebhook(request, env) {
  try {
    if (!env.POLAR_PRODUCT_ID) throw Object.assign(new Error("Polar product is not configured"), { status: 503 });
    const rawBody = await readLimitedWebhookBody(request);
    const webhookId = await verifyPolarWebhook(rawBody, request.headers, env.POLAR_WEBHOOK_SECRET);
    const payload = JSON.parse(rawBody);
    const userId = githubIdFromPolarEvent(payload);
    const event = normalizePolarEvent(payload, webhookId, env.POLAR_PRODUCT_ID);
    if (event.ignored) return json({ received: true, ignored: true }, 202);
    const result = await accountRequest(env, userId, "/internal/polar-event", { method: "POST", body: JSON.stringify(event) });
    return json({ received: true, duplicate: Boolean(result.duplicate), ignored: Boolean(result.ignored) }, 202);
  } catch (error) {
    const status = error instanceof SyntaxError ? 400 : error.status || 400;
    return json({ error: error instanceof Error ? error.message : String(error) }, status);
  }
}

function adminStub(env) {
  return env.BILLING_ADMIN.get(env.BILLING_ADMIN.idFromName("global"));
}

async function adminList(env, query) {
  const url = new URL("http://billing-admin/internal/accounts");
  if (query) url.searchParams.set("query", query);
  const response = await adminStub(env).fetch(new Request(url));
  if (!response.ok) throw new Error("Could not load the billing audit index");
  return response.json();
}

export async function handleBillingAdmin(request, env, user) {
  if (!isAdminUser(user, env)) return json({ error: "Admin access required" }, 403);
  const url = new URL(request.url);
  try {
    if (request.method === "GET" && url.pathname === "/api/admin/accounts") {
      return json(await adminList(env, url.searchParams.get("query") || ""));
    }

    const match = url.pathname.match(/^\/api\/admin\/accounts\/([A-Za-z0-9_-]{1,80})(?:\/(adjust|reconcile|resolve))?$/);
    if (!match) return json({ error: "Route not found" }, 404);
    const [, userId, action] = match;

    if (request.method === "GET" && !action) {
      return json(await accountRequest(env, userId, "/internal/admin"));
    }

    if (request.method === "POST" && action === "adjust") {
      const input = await request.json();
      const adminActionId = request.headers.get("Idempotency-Key");
      if (!adminActionId) throw httpError(428, "Idempotency-Key is required for billing adjustments");
      const result = await accountRequest(env, userId, "/internal/admin/adjust", {
        method: "POST",
        body: JSON.stringify({
          adminActionId,
          delta: input.delta,
          reason: input.reason,
          actorId: user.id,
          actorLogin: user.login,
        }),
      });
      return json(result);
    }

    if (request.method === "POST" && action === "reconcile") {
      const event = await fetchPolarSubscription(env, userId);
      if (event) await accountRequest(env, userId, "/internal/polar-event", { method: "POST", body: JSON.stringify(event) });
      return json(await accountRequest(env, userId, "/internal/admin"));
    }

    if (request.method === "POST" && action === "resolve") {
      const input = await request.json();
      const adminActionId = request.headers.get("Idempotency-Key");
      if (!adminActionId) throw httpError(428, "Idempotency-Key is required for reservation resolution");
      const result = await accountRequest(env, userId, "/internal/admin/resolve", {
        method: "POST",
        body: JSON.stringify({
          adminActionId,
          requestId: input.requestId,
          resolution: input.resolution,
          reason: input.reason,
          actorId: user.id,
          actorLogin: user.login,
        }),
      });
      return json(result);
    }

    return json({ error: "Route not found" }, 404);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, error.status || 400);
  }
}

export async function withUsageAuthorization(request, env, user, action, pieceId, handler) {
  const requestId = request.headers.get("Idempotency-Key");
  if (!requestId) return json({ error: "Idempotency-Key is required for coach sessions" }, 428);
  let authorization;
  try {
    authorization = await accountRequest(env, user.id, "/internal/usage/authorize", {
      method: "POST",
      body: JSON.stringify({ requestId, action, pieceId, admin: isAdminUser(user, env) }),
    });
  } catch (error) {
    const reason = error.payload?.reason;
    const message = reason === "monthly_allowance_exhausted"
      ? "This month’s coach sessions are used up"
      : reason === "idempotency_conflict"
        ? "This idempotency key was already used for another coach session"
        : reason === "operation_released"
          ? "This coach-session request was already released"
          : "A monthly subscription is required for coach sessions";
    return json({ error: message, reason }, error.status || 402);
  }

  if (authorization.duplicate) {
    if (authorization.operation.status === "completed" && authorization.operation.result) {
      return new Response(authorization.operation.result.body, {
        status: authorization.operation.result.status,
        headers: {
          "Content-Type": authorization.operation.result.contentType,
          "Cache-Control": "no-store",
          "X-Usage-Remaining": authorization.remaining === null ? "unlimited" : String(authorization.remaining),
          "X-Idempotent-Replay": "true",
        },
      });
    }
    if (authorization.operation.status === "completed") {
      return json(
        { error: "This operation was settled by an administrator and has no replayable response", reason: "usage_settlement_resolved", requestId },
        409,
        { "X-Usage-Status": "completed" },
      );
    }
    return json(
      { error: "The same operation is awaiting billing settlement", reason: "usage_settlement_pending", requestId },
      409,
      { "X-Usage-Status": "pending" },
    );
  }

  let downstreamAccepted = false;
  try {
    const response = await handler();
    downstreamAccepted = response.ok;
    const body = await response.text();
    if (!response.ok) {
      await accountRequest(env, user.id, "/internal/usage/release", {
        method: "POST",
        body: JSON.stringify({ requestId, reason: `downstream status ${response.status}` }),
      });
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    }
    const headers = new Headers(response.headers);
    headers.set("X-Usage-Remaining", authorization.remaining === null ? "unlimited" : String(authorization.remaining));
    let resolvedPieceId = pieceId;
    if (!resolvedPieceId && action === "initial_read") {
      try { resolvedPieceId = JSON.parse(body).id || null; } catch { resolvedPieceId = null; }
    }
    try {
      await accountRequest(env, user.id, "/internal/usage/complete", {
        method: "POST",
        body: JSON.stringify({
          requestId,
          result: {
            status: response.status,
            body,
            contentType: response.headers.get("Content-Type") || "application/json; charset=utf-8",
            pieceId: resolvedPieceId,
          },
        }),
      });
      headers.set("X-Usage-Status", "completed");
    } catch {
      // The work was accepted. Releasing here would make an accepted request
      // free, so leave the reservation pending for retry or admin resolution.
      headers.set("X-Usage-Status", "pending");
    }
    return new Response(body, { status: response.status, headers });
  } catch (error) {
    if (!downstreamAccepted) {
      await accountRequest(env, user.id, "/internal/usage/release", {
        method: "POST",
        body: JSON.stringify({ requestId, reason: error instanceof Error ? error.message : String(error) }),
      }).catch(() => {});
    }
    throw error;
  }
}
