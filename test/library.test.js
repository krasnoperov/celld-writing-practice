import assert from "node:assert/strict";
import test from "node:test";
import worker, { BillingAdmin, WritingAccount, WritingCoach } from "../src/worker.js";
import { WritingLibrary } from "../src/library.js";
import { signToken } from "../src/auth.js";
import { applyPolarEvent, createAccount, registerProfile } from "../src/account-core.js";

class FakeStorage {
  constructor() { this.values = new Map(); }
  async get(key) { return structuredClone(this.values.get(key)); }
  async put(key, value) { this.values.set(key, structuredClone(value)); }
  async delete(key) { return this.values.delete(key); }
  async deleteAll() { this.values.clear(); }
  async list({ prefix } = {}) {
    return new Map([...this.values.entries()]
      .filter(([key]) => !prefix || key.startsWith(prefix))
      .sort(([left], [right]) => left < right ? -1 : 1)
      .map(([key, value]) => [key, structuredClone(value)]));
  }
  async setAlarm(value) { this.alarmAt = value; }
  async deleteAlarm() { this.alarmAt = null; }
}

class FakeNamespace {
  constructor(ObjectClass, env) {
    this.ObjectClass = ObjectClass;
    this.env = env;
    this.instances = new Map();
  }
  idFromName(name) { return name; }
  get(id) {
    if (!this.instances.has(id)) this.instances.set(id, new this.ObjectClass({ storage: new FakeStorage() }, this.env));
    return this.instances.get(id);
  }
}

async function authenticatedRequest(env, path, method = "GET", input) {
  const session = await signToken({
    kind: "session",
    id: "github-user-1",
    login: "writer",
    exp: Date.now() + 60_000,
  }, env.SESSION_SECRET);
  const init = {
    method,
    headers: {
      Cookie: `wc_session=${session}`,
      ...(input === undefined ? {} : { "Content-Type": "application/json" }),
      ...(method === "POST" ? { "Idempotency-Key": crypto.randomUUID() } : {}),
    },
  };
  if (input !== undefined) init.body = JSON.stringify(input);
  return worker.fetch(new Request(`https://example.test${path}`, init), env);
}

async function json(response) {
  const payload = await response.json();
  assert.ok(response.ok, JSON.stringify(payload));
  return payload;
}

function environment() {
  const env = {
    COACH_PROVIDER: "demo",
    SESSION_SECRET: "a sufficiently long test secret",
    MONTHLY_AGENT_RUNS: "50",
    ADMIN_GITHUB_IDS: "nobody",
  };
  env.COACHES = new FakeNamespace(WritingCoach, env);
  env.LIBRARIES = new FakeNamespace(WritingLibrary, env);
  env.ACCOUNTS = new FakeNamespace(WritingAccount, env);
  env.BILLING_ADMIN = new FakeNamespace(BillingAdmin, env);
  const account = createAccount("github-user-1", 50);
  registerProfile(account, { login: "writer", avatarUrl: "" });
  applyPolarEvent(account, {
    webhookId: "seed-subscription",
    eventType: "subscription.active",
    eventAt: "2026-08-01T00:00:00.000Z",
    subscription: {
      id: "sub_test",
      status: "active",
      customerId: "customer_test",
      productId: "product_test",
      currentPeriodStart: "2026-08-01T00:00:00.000Z",
      currentPeriodEnd: "2099-09-01T00:00:00.000Z",
      cancelAtPeriodEnd: false,
      modifiedAt: "2026-08-01T00:00:00.000Z",
    },
    order: null,
  });
  env.ACCOUNTS.get("github:github-user-1").state.storage.values.set("account", structuredClone(account));
  return env;
}

const firstInput = {
  subject: "AI coding assistants and code review",
  aim: "Engineering managers — examine total delivery effort.",
};

test("a user shelf owns several isolated piece cells", async () => {
  const env = environment();
  const first = await json(await authenticatedRequest(env, "/api/pieces", "POST", firstInput));
  const second = await json(await authenticatedRequest(env, "/api/pieces", "POST", {
    ...firstInput,
    subject: "How adults retain a second language",
  }));
  assert.notEqual(first.id, second.id);

  const shelf = await json(await authenticatedRequest(env, "/api/pieces"));
  assert.equal(shelf.pieces.length, 2);
  assert.deepEqual(new Set(shelf.pieces.map((piece) => piece.status.brief.subject)), new Set([
    firstInput.subject,
    "How adults retain a second language",
  ]));
  assert.ok(shelf.pieces.every((piece) => piece.status.activeJob?.kind === "reading"));

  const firstDraft = await authenticatedRequest(env, `/api/pieces/${first.id}/docs/draft`);
  const firstRevision = firstDraft.headers.get("X-Document-Revision");
  assert.equal(await firstDraft.text(), "");
  const draftText = "This draft belongs only to the first piece. It contains enough material to demonstrate that each writing piece has isolated Markdown storage and revision history.";
  const saved = await worker.fetch(new Request(`https://example.test/api/pieces/${first.id}/docs/draft`, {
    method: "PUT",
    headers: {
      Cookie: `wc_session=${await signToken({ kind: "session", id: "github-user-1", login: "writer", exp: Date.now() + 60_000 }, env.SESSION_SECRET)}`,
      "Content-Type": "text/markdown",
      "X-Document-Revision": firstRevision,
    },
    body: draftText,
  }), env);
  assert.equal(saved.status, 204);
  const secondDraft = await authenticatedRequest(env, `/api/pieces/${second.id}/docs/draft`);
  assert.equal(await secondDraft.text(), "");
});

test("deleting one piece removes its notes without affecting another piece", async () => {
  const env = environment();
  const first = await json(await authenticatedRequest(env, "/api/pieces", "POST", firstInput));
  const second = await json(await authenticatedRequest(env, "/api/pieces", "POST", { ...firstInput, topic: "A second independent piece" }));
  const firstCell = env.COACHES.get(`github:github-user-1:piece:${first.id}`);
  const accountCell = env.ACCOUNTS.get("github:github-user-1");
  const beforeDelete = accountCell.state.storage.values.get("account");
  assert.ok(firstCell.state.storage.values.has("history:draft:1"));
  assert.ok(beforeDelete.operations.some((operation) => operation.pieceId === first.id && operation.result.body.includes(firstInput.subject)));

  await json(await authenticatedRequest(env, `/api/pieces/${first.id}`, "DELETE"));
  assert.equal([...firstCell.state.storage.values.keys()].some((key) => key.startsWith("history:")), false);
  assert.equal(firstCell.state.storage.values.has("piece"), false);

  const remaining = await json(await authenticatedRequest(env, "/api/pieces"));
  assert.deepEqual(remaining.pieces.map((piece) => piece.id), [second.id]);
  const secondPiece = await json(await authenticatedRequest(env, `/api/pieces/${second.id}`));
  assert.equal(secondPiece.exists, true);
  const afterDelete = accountCell.state.storage.values.get("account");
  assert.equal(afterDelete.operations.some((operation) => operation.pieceId === first.id), false);
});

test("a delayed Polar event cannot recreate a deleted account", async () => {
  const env = environment();
  const accountCell = env.ACCOUNTS.get("github:github-user-1");
  accountCell.state.storage.values.clear();

  const response = await accountCell.fetch(new Request("http://account/internal/polar-event", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Account-User-ID": "github-user-1" },
    body: JSON.stringify({ webhookId: "late-event", eventType: "subscription.canceled", eventAt: new Date().toISOString() }),
  }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ignored, true);
  assert.equal(accountCell.state.storage.values.size, 0);
});

test("account deletion waits for the subscription to end, then removes every piece and account record", async () => {
  const env = environment();
  const first = await json(await authenticatedRequest(env, "/api/pieces", "POST", firstInput));

  const blocked = await authenticatedRequest(env, "/api/account", "DELETE");
  assert.equal(blocked.status, 409);
  assert.match((await blocked.json()).error, /subscription must end/i);

  const accountCell = env.ACCOUNTS.get("github:github-user-1");
  const account = structuredClone(accountCell.state.storage.values.get("account"));
  account.subscription.cancelAtPeriodEnd = true;
  accountCell.state.storage.values.set("account", account);

  const stillActive = await authenticatedRequest(env, "/api/account", "DELETE");
  assert.equal(stillActive.status, 409);
  assert.match((await stillActive.json()).error, /subscription must end/i);

  account.subscription.status = "canceled";
  account.subscription.currentPeriodEnd = "2026-08-11T00:00:00.000Z";
  accountCell.state.storage.values.set("account", account);

  const deleted = await authenticatedRequest(env, "/api/account", "DELETE");
  assert.equal(deleted.status, 200);
  assert.match(deleted.headers.get("Set-Cookie"), /wc_session=;/);

  const pieceCell = env.COACHES.get(`github:github-user-1:piece:${first.id}`);
  assert.equal(pieceCell.state.storage.values.size, 0);
  assert.equal(env.LIBRARIES.get("github:github-user-1").state.storage.values.size, 0);
  assert.equal(accountCell.state.storage.values.size, 0);
  const adminState = env.BILLING_ADMIN.get("global").state.storage.values.get("billing-admin");
  assert.equal(adminState?.accounts?.["github-user-1"], undefined);
});

test("account deletion fails closed when a piece cell rejects deletion", async () => {
  const env = environment();
  const piece = await json(await authenticatedRequest(env, "/api/pieces", "POST", firstInput));
  const accountCell = env.ACCOUNTS.get("github:github-user-1");
  const account = structuredClone(accountCell.state.storage.values.get("account"));
  account.subscription.status = "canceled";
  account.subscription.currentPeriodEnd = "2026-08-11T00:00:00.000Z";
  accountCell.state.storage.values.set("account", account);

  const pieceCell = env.COACHES.get(`github:github-user-1:piece:${piece.id}`);
  const originalFetch = pieceCell.fetch.bind(pieceCell);
  pieceCell.fetch = async (request) => request.method === "DELETE"
    ? Response.json({ error: "simulated piece deletion failure" }, { status: 503 })
    : originalFetch(request);

  const response = await authenticatedRequest(env, "/api/account", "DELETE");
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /could not delete piece/i);
  assert.ok(accountCell.state.storage.values.has("account"));
  assert.ok(env.LIBRARIES.get("github:github-user-1").state.storage.values.size > 0);
});

test("account deletion does not report success while the billing projection remains", async () => {
  const env = environment();
  const accountCell = env.ACCOUNTS.get("github:github-user-1");
  const account = structuredClone(accountCell.state.storage.values.get("account"));
  account.subscription.status = "canceled";
  account.subscription.currentPeriodEnd = "2026-08-11T00:00:00.000Z";
  accountCell.state.storage.values.set("account", account);

  const admin = env.BILLING_ADMIN.get("global");
  const originalFetch = admin.fetch.bind(admin);
  admin.fetch = async (request) => request.method === "DELETE"
    ? Response.json({ error: "simulated projection failure" }, { status: 503 })
    : originalFetch(request);

  const response = await authenticatedRequest(env, "/api/account", "DELETE");
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /billing audit projection/i);
  assert.ok(accountCell.state.storage.values.has("account"));
});

test("single-piece deletion reports a shelf removal failure", async () => {
  const env = environment();
  const piece = await json(await authenticatedRequest(env, "/api/pieces", "POST", firstInput));
  const library = env.LIBRARIES.get("github:github-user-1");
  const originalFetch = library.fetch.bind(library);
  library.fetch = async (request) => request.method === "DELETE" && new URL(request.url).pathname.startsWith("/internal/pieces/")
    ? Response.json({ error: "simulated shelf removal failure" }, { status: 503 })
    : originalFetch(request);

  const response = await authenticatedRequest(env, `/api/pieces/${piece.id}`, "DELETE");
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /simulated shelf removal failure/i);
  assert.ok(library.state.storage.values.size > 0);
});

test("signed-in users need a subscription while configured admins retain audit access", async () => {
  const env = environment();
  const inactive = createAccount("github-user-1", 50);
  registerProfile(inactive, { login: "writer", avatarUrl: "" });
  env.ACCOUNTS.get("github:github-user-1").state.storage.values.set("account", structuredClone(inactive));

  const denied = await authenticatedRequest(env, "/api/pieces", "POST", firstInput);
  assert.equal(denied.status, 402);
  assert.match((await denied.json()).error, /monthly subscription/i);

  env.ADMIN_GITHUB_IDS = "github-user-1";
  const allowed = await authenticatedRequest(env, "/api/pieces", "POST", firstInput);
  assert.equal(allowed.status, 202);

  env.PUBLIC_BASE_URL = "https://example.test";
  const session = await signToken({ kind: "session", id: "github-user-1", login: "writer", exp: Date.now() + 60_000 }, env.SESSION_SECRET);
  const crossSite = await worker.fetch(new Request("https://example.test/api/admin/accounts/github-user-1/adjust", {
    method: "POST",
    headers: { Cookie: `wc_session=${session}`, Origin: "https://attacker.example", "Content-Type": "application/json" },
    body: JSON.stringify({ delta: 10, reason: "This request must not reach the account" }),
  }), env);
  assert.equal(crossSite.status, 403);
});
