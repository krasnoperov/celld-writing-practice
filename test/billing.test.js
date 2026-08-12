import assert from "node:assert/strict";
import test from "node:test";
import {
  adminAccount,
  adjustCredits,
  applyPolarEvent,
  authorizeUsage,
  completeUsage,
  createAccount,
  hasPaidAccess,
  purgePieceUsage,
  registerProfile,
  remainingCredits,
  resolveUsage,
} from "../src/account-core.js";
import { METERED_PROVIDER_ACTIONS, PIECE_PROVIDER_ACTIONS } from "../src/action-policy.js";
import { MAX_POLAR_WEBHOOK_BYTES, readLimitedWebhookBody, withUsageAuthorization } from "../src/billing.js";
import { chargeableAction } from "../src/pieces.js";
import { fetchPolarSubscription, githubIdFromPolarEvent, normalizePolarEvent, verifyPolarWebhook } from "../src/polar.js";

function subscriptionEvent(overrides = {}) {
  return {
    webhookId: overrides.webhookId || crypto.randomUUID(),
    eventType: overrides.eventType || "subscription.active",
    eventAt: overrides.modifiedAt || "2026-08-01T00:00:00.000Z",
    subscription: {
      id: "sub_1",
      status: "active",
      customerId: "customer_1",
      productId: "product_1",
      currentPeriodStart: "2026-08-01T00:00:00.000Z",
      currentPeriodEnd: "2099-09-01T00:00:00.000Z",
      cancelAtPeriodEnd: false,
      modifiedAt: "2026-08-01T00:00:00.000Z",
      ...overrides,
    },
    order: null,
  };
}

test("subscription periods grant a monthly balance and stale webhooks cannot revoke it", () => {
  const account = createAccount("42", 50);
  registerProfile(account, { login: "writer", avatarUrl: "" });
  const active = subscriptionEvent({ webhookId: "active" });
  applyPolarEvent(account, active);
  assert.equal(hasPaidAccess(account), true);
  assert.equal(remainingCredits(account), 50);

  applyPolarEvent(account, subscriptionEvent({
    webhookId: "stale-revoke",
    eventType: "subscription.revoked",
    status: "canceled",
    modifiedAt: "2026-07-31T23:59:59.000Z",
  }));
  assert.equal(account.subscription.status, "active");
  assert.equal(account.audit.at(-1).type, "webhook_ignored");

  const duplicate = applyPolarEvent(account, active);
  assert.equal(duplicate.duplicate, true);
});

test("agent-run reservations are charged once, replay their result, and remain auditable", () => {
  const account = createAccount("42", 2);
  applyPolarEvent(account, subscriptionEvent({ webhookId: "active" }));
  const first = authorizeUsage(account, { requestId: "request-1", action: "research", pieceId: "p1", admin: false });
  assert.equal(first.allowed, true);
  assert.equal(first.remaining, 1);
  const duplicate = authorizeUsage(account, { requestId: "request-1", action: "research", pieceId: "p1", admin: false });
  assert.equal(duplicate.duplicate, true);
  assert.equal(remainingCredits(account), 1);

  completeUsage(account, "request-1", { status: 202, body: "{}", contentType: "application/json" });
  assert.equal(authorizeUsage(account, { requestId: "request-1", action: "research", pieceId: "p1", admin: false }).operation.result.status, 202);
  adjustCredits(account, {
    adminActionId: "adjustment-1",
    delta: 3,
    reason: "Support reconciliation",
    actorId: "admin-1",
    actorLogin: "admin",
  });
  assert.equal(remainingCredits(account), 4);
  assert.equal(account.audit.at(-1).type, "admin_adjustment");
});

test("deleting a piece removes its cached replay body from the account ledger", () => {
  const account = createAccount("42", 50);
  applyPolarEvent(account, subscriptionEvent({ webhookId: "active-for-purge" }));
  authorizeUsage(account, { requestId: "create-1", action: "initial_read", pieceId: null, admin: false });
  completeUsage(account, "create-1", {
    status: 202,
    contentType: "application/json",
    body: JSON.stringify({ id: "piece-1", brief: { subject: "Private subject" } }),
    pieceId: "piece-1",
  });

  assert.match(account.operations[0].result.body, /Private subject/);
  assert.equal(purgePieceUsage(account, "piece-1").removed, 1);
  assert.equal(account.operations.length, 0);
  assert.equal(account.audit.some((event) => event.data?.pieceId === "piece-1"), false);
});

test("the shared provider-action policy meters every routed coach action", () => {
  assert.deepEqual(METERED_PROVIDER_ACTIONS, ["initial_read", "read", "letter", "verdict", "margin", "answer"]);
  assert.deepEqual(PIECE_PROVIDER_ACTIONS, ["read", "letter", "verdict", "margin", "answer"]);

  const creation = new Request("https://example.test/api/pieces", { method: "POST" });
  assert.deepEqual(chargeableAction(creation, new URL(creation.url)), { action: "initial_read", pieceId: null });
  for (const action of PIECE_PROVIDER_ACTIONS) {
    const request = new Request(`https://example.test/api/pieces/piece-1/actions/${action}`, { method: "POST" });
    assert.deepEqual(chargeableAction(request, new URL(request.url)), { action, pieceId: "piece-1" });
  }
  const readOnly = new Request("https://example.test/api/pieces/piece-1/actions/answer");
  assert.equal(chargeableAction(readOnly, new URL(readOnly.url)), null);
  const unknown = new Request("https://example.test/api/pieces/piece-1/actions/unmetered", { method: "POST" });
  assert.equal(chargeableAction(unknown, new URL(unknown.url)), null);
});

test("subscription access fails closed when the provider period end is missing or invalid", () => {
  const account = createAccount("42", 50);
  applyPolarEvent(account, subscriptionEvent({ webhookId: "missing-period-end", currentPeriodEnd: null }));
  assert.equal(hasPaidAccess(account), false);

  applyPolarEvent(account, subscriptionEvent({ webhookId: "invalid-period-end", currentPeriodEnd: "not-a-date", modifiedAt: "2026-08-02T00:00:00.000Z" }));
  assert.equal(hasPaidAccess(account), false);

  applyPolarEvent(account, subscriptionEvent({ webhookId: "valid-period-end", currentPeriodEnd: "2099-09-01T00:00:00.000Z", modifiedAt: "2026-08-03T00:00:00.000Z" }));
  assert.equal(hasPaidAccess(account), true);
});

test("usage idempotency keys are bound to their action and piece", () => {
  const account = createAccount("42", 3);
  applyPolarEvent(account, subscriptionEvent({ webhookId: "active-for-idempotency" }));
  assert.equal(authorizeUsage(account, { requestId: "same-key", action: "read", pieceId: "piece-1", admin: false }).allowed, true);
  assert.equal(authorizeUsage(account, { requestId: "same-key", action: "read", pieceId: "piece-1", admin: false }).duplicate, true);

  const actionConflict = authorizeUsage(account, { requestId: "same-key", action: "answer", pieceId: "piece-1", admin: false });
  assert.deepEqual({ allowed: actionConflict.allowed, reason: actionConflict.reason }, { allowed: false, reason: "idempotency_conflict" });
  const pieceConflict = authorizeUsage(account, { requestId: "same-key", action: "read", pieceId: "piece-2", admin: false });
  assert.deepEqual({ allowed: pieceConflict.allowed, reason: pieceConflict.reason }, { allowed: false, reason: "idempotency_conflict" });
  assert.equal(account.usage.used, 1);
});

test("admin adjustments and pending-reservation resolutions are idempotent and audited", () => {
  const account = createAccount("42", 2);
  applyPolarEvent(account, subscriptionEvent({ webhookId: "active-for-admin" }));
  const adjustment = {
    adminActionId: "admin-action-1",
    delta: 2,
    reason: "Support reconciliation",
    actorId: "7",
    actorLogin: "operator",
  };
  assert.equal(adjustCredits(account, adjustment).duplicate, false);
  assert.equal(adjustCredits(account, adjustment).duplicate, true);
  assert.equal(account.usage.granted, 4);
  assert.throws(() => adjustCredits(account, { ...adjustment, delta: 3 }), (error) => error.status === 409);

  authorizeUsage(account, { requestId: "pending-release", action: "read", pieceId: "piece-1", admin: false });
  const release = {
    adminActionId: "admin-action-2",
    requestId: "pending-release",
    resolution: "released",
    reason: "Accepted work was not delivered",
    actorId: "7",
    actorLogin: "operator",
  };
  assert.equal(resolveUsage(account, release).duplicate, false);
  assert.equal(resolveUsage(account, release).duplicate, true);
  assert.equal(account.usage.used, 0);

  authorizeUsage(account, { requestId: "pending-complete", action: "answer", pieceId: "piece-1", admin: false });
  resolveUsage(account, { ...release, adminActionId: "admin-action-3", requestId: "pending-complete", resolution: "completed", reason: "Accepted response verified in logs" });
  assert.equal(account.usage.used, 1);
  assert.equal(account.operations.find((value) => value.id === "pending-complete").status, "completed");
  assert.equal(account.audit.filter((event) => event.type === "admin_adjustment").length, 1);
  assert.equal(account.audit.filter((event) => event.type === "usage_admin_released").length, 1);
  assert.equal(account.audit.filter((event) => event.type === "usage_admin_completed").length, 1);
});

test("failed admin operations do not consume their idempotency key", () => {
  const account = createAccount("42", 1);
  account.usage.granted = 0;
  account.usage.used = 1;
  assert.throws(() => adjustCredits(account, {
    adminActionId: "retryable-action",
    delta: -1,
    reason: "Invalid negative adjustment",
    actorId: "7",
    actorLogin: "operator",
  }), /balance negative/);
  assert.equal(account.adminActions.length, 0);
  assert.equal(adjustCredits(account, {
    adminActionId: "retryable-action",
    delta: 2,
    reason: "Corrected positive adjustment",
    actorId: "7",
    actorLogin: "operator",
  }).duplicate, false);
});

test("admin account payloads redact cached provider response bodies", () => {
  const account = createAccount("42", 1);
  applyPolarEvent(account, subscriptionEvent({ webhookId: "active-for-redaction" }));
  authorizeUsage(account, { requestId: "redacted", action: "answer", pieceId: "piece-1", admin: false });
  completeUsage(account, "redacted", { status: 202, body: "private generated response", contentType: "application/json" });

  const result = adminAccount(account).operations[0].result;
  assert.deepEqual(result, { status: 202, contentType: "application/json", bodyLength: 26 });
  assert.equal(Object.hasOwn(result, "body"), false);
});

function usageEnvironment({ completeStatus = 200 } = {}) {
  const calls = [];
  const stub = {
    async fetch(request) {
      const pathname = new URL(request.url).pathname;
      calls.push(pathname);
      if (pathname === "/internal/usage/authorize") {
        return Response.json({
          allowed: true,
          duplicate: false,
          operation: { id: "request-1", status: "reserved" },
          remaining: 4,
        });
      }
      if (pathname === "/internal/usage/complete" && completeStatus !== 200) {
        return Response.json({ error: "simulated settlement failure" }, { status: completeStatus });
      }
      return Response.json({ ok: true });
    },
  };
  return {
    calls,
    env: {
      ADMIN_GITHUB_IDS: "",
      ACCOUNTS: { idFromName: (value) => value, get: () => stub },
    },
  };
}

test("accepted work stays reserved when completion persistence fails", async () => {
  const { env, calls } = usageEnvironment({ completeStatus: 503 });
  const request = new Request("https://example.test/api/pieces/piece-1/actions/answer", {
    method: "POST",
    headers: { "Idempotency-Key": "request-1" },
  });
  const response = await withUsageAuthorization(request, env, { id: "42" }, "answer", "piece-1", async () => Response.json({ accepted: true }, { status: 202 }));
  assert.equal(response.status, 202);
  assert.equal(response.headers.get("X-Usage-Status"), "pending");
  assert.equal(calls.includes("/internal/usage/release"), false);
});

test("work rejected before acceptance releases its reservation", async () => {
  const { env, calls } = usageEnvironment();
  const request = new Request("https://example.test/api/pieces/piece-1/actions/answer", {
    method: "POST",
    headers: { "Idempotency-Key": "request-1" },
  });
  await assert.rejects(
    () => withUsageAuthorization(request, env, { id: "42" }, "answer", "piece-1", async () => { throw new Error("provider unavailable"); }),
    /provider unavailable/,
  );
  assert.equal(calls.includes("/internal/usage/release"), true);
});

test("Polar Standard Webhooks signatures bind the raw body, timestamp, and id", async () => {
  const secret = "test-polar-secret";
  const webhookId = "msg_test_1";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify({ type: "subscription.active", data: { id: "sub_1" } });
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${webhookId}.${timestamp}.${body}`)));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const headers = new Headers({
    "webhook-id": webhookId,
    "webhook-timestamp": timestamp,
    "webhook-signature": `v1,${btoa(binary)}`,
  });
  assert.equal(await verifyPolarWebhook(body, headers, secret), webhookId);
  await assert.rejects(() => verifyPolarWebhook(`${body} `, headers, secret), /invalid/);
  await assert.rejects(() => verifyPolarWebhook(body, new Headers({ ...Object.fromEntries(headers), "webhook-timestamp": "1" }), secret), /replay window/);
});

test("Polar webhook bodies are bounded before signature parsing", async () => {
  const accepted = JSON.stringify({ type: "subscription.active", data: { id: "sub_1" } });
  assert.equal(await readLimitedWebhookBody(new Request("https://example.test", { method: "POST", body: accepted })), accepted);

  const oversized = "x".repeat(MAX_POLAR_WEBHOOK_BYTES + 1);
  await assert.rejects(
    () => readLimitedWebhookBody(new Request("https://example.test", { method: "POST", body: oversized })),
    (error) => error.status === 413 && /too large/i.test(error.message),
  );
});

test("Polar subscription payloads retain GitHub identity and cancellation semantics", () => {
  const payload = {
    type: "subscription.canceled",
    timestamp: "2026-08-06T12:00:00.000Z",
    data: {
      id: "sub_1",
      status: "active",
      product_id: "product_1",
      current_period_start: "2026-08-01T00:00:00.000Z",
      current_period_end: "2026-09-01T00:00:00.000Z",
      cancel_at_period_end: true,
      customer: { id: "customer_1", external_id: "github:42" },
    },
  };
  const normalized = normalizePolarEvent(payload, "msg_1", "product_1");
  assert.equal(normalized.subscription.status, "active");
  assert.equal(normalized.subscription.cancelAtPeriodEnd, true);
});

test("reconciliation does not invent an inactive event while Polar is still propagating checkout", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ items: [] });
  try {
    assert.equal(await fetchPolarSubscription({ POLAR_ACCESS_TOKEN: "token", POLAR_PRODUCT_ID: "product_1" }, "42"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("events for another Polar product are acknowledged but ignored", () => {
  const normalized = normalizePolarEvent({
    type: "subscription.active",
    data: { id: "sub_other", status: "active", product_id: "other", customer: { external_id: "github:42" } },
  }, "msg_other", "product_1");
  assert.equal(normalized.ignored, true);
  assert.equal(normalized.subscription, null);
});

test("subscription events without the configured product cannot grant access", () => {
  const normalized = normalizePolarEvent({
    type: "subscription.active",
    data: {
      id: "sub_missing_product",
      status: "active",
      current_period_end: "2099-09-01T00:00:00.000Z",
      customer: { external_id: "github:42" },
    },
  }, "msg_missing_product", "product_1");
  assert.equal(normalized.ignored, true);
  assert.equal(normalized.subscription, null);
});

test("subscription reconciliation ignores records without an exact product match", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    items: [{
      id: "sub_other",
      status: "active",
      product_id: "other",
      current_period_end: "2099-09-01T00:00:00.000Z",
      customer: { external_id: "github:42" },
    }],
  });
  try {
    assert.equal(await fetchPolarSubscription({ POLAR_ACCESS_TOKEN: "token", POLAR_PRODUCT_ID: "product_1" }, "42"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("customer state webhooks route by the root external ID", () => {
  const payload = {
    type: "customer.state_changed",
    data: {
      id: "customer_1",
      external_id: "github:42",
      active_subscriptions: [{ id: "sub_1", status: "active", product_id: "product_1" }],
    },
  };
  assert.equal(githubIdFromPolarEvent(payload), "42");
  assert.equal(normalizePolarEvent(payload, "msg_state", "product_1").subscription.customerId, "customer_1");
});
