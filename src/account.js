import { json } from "./http.js";
import { integer, text } from "./validate.js";
import {
  ACCOUNT_VERSION,
  adminAccount,
  accountSummary,
  adjustCredits,
  applyPolarEvent,
  authorizeUsage,
  completeUsage,
  createAccount,
  publicAccount,
  purgePieceUsage,
  registerProfile,
  releaseUsage,
  resolveUsage,
} from "./account-core.js";

const ACCOUNT_KEY = "account";
const ADMIN_KEY = "billing-admin";

function monthlyAllowance(env) {
  const value = Number(env.MONTHLY_AGENT_RUNS || 50);
  return Number.isInteger(value) && value > 0 ? value : 50;
}

function accountUserId(request) {
  const userId = request.headers.get("X-Account-User-ID");
  if (!userId || !/^[A-Za-z0-9_-]{1,80}$/.test(userId)) throw new Error("X-Account-User-ID is required");
  return userId;
}

export class WritingAccount {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async load(request) {
    const stored = await this.state.storage.get(ACCOUNT_KEY);
    if (stored?.version === ACCOUNT_VERSION) return stored;
    return createAccount(accountUserId(request), monthlyAllowance(this.env));
  }

  async syncAdmin(account) {
    if (!this.env.BILLING_ADMIN) throw new Error("Billing admin binding is unavailable");
    const admin = this.env.BILLING_ADMIN.get(this.env.BILLING_ADMIN.idFromName("global"));
    const response = await admin.fetch(new Request(`http://billing-admin/internal/accounts/${encodeURIComponent(account.userId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(accountSummary(account)),
    }));
    if (!response.ok) throw new Error(`Billing admin projection rejected account ${account.userId}`);
    account.pendingAdminSync = false;
    account.adminSyncAttempts = 0;
    await this.state.storage.put(ACCOUNT_KEY, account);
    if (this.state.storage.deleteAlarm) await this.state.storage.deleteAlarm();
  }

  async persist(account) {
    account.pendingAdminSync = true;
    await this.state.storage.put(ACCOUNT_KEY, account);
    await this.state.storage.setAlarm(Date.now());
    try {
      await this.syncAdmin(account);
    } catch {
      account.adminSyncAttempts = (account.adminSyncAttempts || 0) + 1;
      await this.state.storage.put(ACCOUNT_KEY, account);
      const delay = Math.min(60_000, 1000 * 2 ** Math.min(account.adminSyncAttempts, 6));
      await this.state.storage.setAlarm(Date.now() + delay);
    }
  }

  async fetch(request) {
    const url = new URL(request.url);
    try {
      if (request.method === "POST" && url.pathname === "/internal/polar-event") {
        const stored = await this.state.storage.get(ACCOUNT_KEY);
        if (!stored) return json({ ignored: true, reason: "account_missing" });
      }
      const account = await this.load(request);

      if (request.method === "GET" && url.pathname === "/internal/status") {
        const admin = url.searchParams.get("admin") === "true";
        return json(publicAccount(account, {
          admin,
          configured: Boolean(this.env.POLAR_ACCESS_TOKEN && this.env.POLAR_PRODUCT_ID && this.env.POLAR_WEBHOOK_SECRET),
          planName: this.env.PLAN_NAME,
        }));
      }

      if (request.method === "GET" && url.pathname === "/internal/admin") return json(adminAccount(account));

      if (request.method === "POST" && url.pathname === "/internal/profile") {
        const input = await request.json();
        registerProfile(account, {
          login: text(input.login, "login", { max: 80 }),
          avatarUrl: typeof input.avatarUrl === "string" ? input.avatarUrl.slice(0, 500) : "",
        });
        await this.persist(account);
        return json(accountSummary(account));
      }

      if (request.method === "POST" && url.pathname === "/internal/polar-event") {
        const input = await request.json();
        const result = applyPolarEvent(account, input);
        await this.persist(account);
        return json({ duplicate: result.duplicate, summary: accountSummary(account) });
      }

      if (request.method === "POST" && url.pathname === "/internal/usage/authorize") {
        const input = await request.json();
        const result = authorizeUsage(account, {
          requestId: text(input.requestId, "requestId", { max: 120 }),
          action: text(input.action, "action", { max: 80 }),
          pieceId: input.pieceId ? text(input.pieceId, "pieceId", { max: 80 }) : null,
          admin: Boolean(input.admin),
        });
        if (result.allowed && !result.duplicate) await this.persist(account);
        const status = result.allowed ? 200 : result.reason === "idempotency_conflict" ? 409 : 402;
        return json(result, status);
      }

      if (request.method === "POST" && url.pathname === "/internal/usage/complete") {
        const input = await request.json();
        const value = completeUsage(account, text(input.requestId, "requestId", { max: 120 }), {
          status: integer(input.result?.status, "result.status", { min: 200, max: 299 }),
          body: typeof input.result?.body === "string" ? input.result.body.slice(0, 16_000) : "",
          contentType: typeof input.result?.contentType === "string" ? input.result.contentType.slice(0, 200) : "application/json; charset=utf-8",
          pieceId: input.result?.pieceId ? text(input.result.pieceId, "result.pieceId", { max: 80 }) : null,
        });
        await this.persist(account);
        return json({ operation: value, summary: accountSummary(account) });
      }

      if (request.method === "POST" && url.pathname === "/internal/usage/purge-piece") {
        const input = await request.json();
        const result = purgePieceUsage(account, text(input.pieceId, "pieceId", { max: 80 }));
        if (result.removed || result.auditRemoved) await this.persist(account);
        return json(result);
      }

      if (request.method === "POST" && url.pathname === "/internal/usage/release") {
        const input = await request.json();
        const value = releaseUsage(account, text(input.requestId, "requestId", { max: 120 }), text(input.reason || "request rejected", "reason", { max: 300 }));
        if (value) await this.persist(account);
        return json({ operation: value, summary: accountSummary(account) });
      }

      if (request.method === "POST" && url.pathname === "/internal/delete") {
        const active = ["active", "trialing"].includes(account.subscription.status);
        if (active) {
          return json({ error: "The subscription must end before the account can be deleted." }, 409);
        }
        if (this.env.BILLING_ADMIN) {
          const admin = this.env.BILLING_ADMIN.get(this.env.BILLING_ADMIN.idFromName("global"));
          const response = await admin.fetch(new Request(`http://billing-admin/internal/accounts/${encodeURIComponent(account.userId)}`, { method: "DELETE" }));
          if (!response.ok) throw Object.assign(new Error("Could not remove the billing audit projection"), { status: 502 });
        }
        await this.state.storage.deleteAll();
        if (this.state.storage.deleteAlarm) await this.state.storage.deleteAlarm();
        return json({ deleted: true });
      }

      if (request.method === "POST" && url.pathname === "/internal/admin/adjust") {
        const input = await request.json();
        const result = adjustCredits(account, {
          adminActionId: text(input.adminActionId, "adminActionId", { max: 120 }),
          delta: integer(input.delta, "delta", { min: -10_000, max: 10_000 }),
          reason: text(input.reason, "reason", { min: 5, max: 300 }),
          actorId: text(input.actorId, "actorId", { max: 80 }),
          actorLogin: text(input.actorLogin, "actorLogin", { max: 80 }),
        });
        if (!result.duplicate) await this.persist(account);
        return json({ duplicate: result.duplicate, summary: accountSummary(account) });
      }

      if (request.method === "POST" && url.pathname === "/internal/admin/resolve") {
        const input = await request.json();
        const result = resolveUsage(account, {
          adminActionId: text(input.adminActionId, "adminActionId", { max: 120 }),
          requestId: text(input.requestId, "requestId", { max: 120 }),
          resolution: text(input.resolution, "resolution", { max: 20 }),
          reason: text(input.reason, "reason", { min: 5, max: 300 }),
          actorId: text(input.actorId, "actorId", { max: 80 }),
          actorLogin: text(input.actorLogin, "actorLogin", { max: 80 }),
        });
        if (!result.duplicate) await this.persist(account);
        return json({ duplicate: result.duplicate, operation: result.operation, summary: accountSummary(account) });
      }

      return json({ error: "Route not found" }, 404);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, error.status || 400);
    }
  }

  async alarm() {
    const account = await this.state.storage.get(ACCOUNT_KEY);
    if (!account?.pendingAdminSync) return;
    try {
      await this.syncAdmin(account);
    } catch {
      account.adminSyncAttempts = (account.adminSyncAttempts || 0) + 1;
      await this.state.storage.put(ACCOUNT_KEY, account);
      const delay = Math.min(5 * 60_000, 1000 * 2 ** Math.min(account.adminSyncAttempts, 8));
      await this.state.storage.setAlarm(Date.now() + delay);
    }
  }
}

export class BillingAdmin {
  constructor(state) {
    this.state = state;
  }

  async load() {
    return (await this.state.storage.get(ADMIN_KEY)) ?? { version: 1, accounts: {}, updatedAt: 0 };
  }

  async fetch(request) {
    const url = new URL(request.url);
    const state = await this.load();
    const match = url.pathname.match(/^\/internal\/accounts\/([A-Za-z0-9_-]{1,80})$/);

    if (request.method === "GET" && url.pathname === "/internal/accounts") {
      const query = (url.searchParams.get("query") || "").trim().toLowerCase();
      const accounts = Object.values(state.accounts)
        .filter((account) => !query || account.userId.toLowerCase().includes(query) || account.login.toLowerCase().includes(query))
        .sort((left, right) => right.updatedAt - left.updatedAt);
      return json({ accounts, updatedAt: state.updatedAt });
    }

    if (request.method === "PUT" && match) {
      const summary = await request.json();
      if (String(summary.userId) !== match[1]) return json({ error: "Account identity mismatch" }, 409);
      state.accounts[match[1]] = summary;
      state.updatedAt = Date.now();
      await this.state.storage.put(ADMIN_KEY, state);
      return json({ stored: true });
    }

    if (request.method === "DELETE" && match) {
      delete state.accounts[match[1]];
      state.updatedAt = Date.now();
      await this.state.storage.put(ADMIN_KEY, state);
      return json({ deleted: true });
    }

    return json({ error: "Route not found" }, 404);
  }
}
