import assert from "node:assert/strict";
import test from "node:test";
import {
  beginIdempotentOperation,
  finishIdempotentOperation,
  retainIdempotencyAfter,
} from "../frontend/src/lib/idempotency.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
  };
}

test("an ambiguous retry reuses one idempotency key until the response is known", async () => {
  const storage = memoryStorage();
  const input = { method: "POST", path: "api/pieces/one/actions/answer", body: { ask: "What is missing?" } };
  const first = await beginIdempotentOperation(input, { storage });
  const retry = await beginIdempotentOperation(input, { storage });
  assert.equal(retry.key, first.key);

  finishIdempotentOperation(first, { storage });
  const laterAction = await beginIdempotentOperation(input, { storage });
  assert.notEqual(laterAction.key, first.key);
});

test("operation fingerprints bind the request body", async () => {
  const storage = memoryStorage();
  const first = await beginIdempotentOperation({ path: "api/pieces", body: { subject: "One" } }, { storage });
  const second = await beginIdempotentOperation({ path: "api/pieces", body: { subject: "Two" } }, { storage });
  assert.notEqual(second.key, first.key);
});

test("only ambiguous failures retain a pending browser operation", () => {
  assert.equal(retainIdempotencyAfter(new TypeError("network lost")), true);
  assert.equal(retainIdempotencyAfter({ status: 503 }), true);
  assert.equal(retainIdempotencyAfter({ status: 409, usageStatus: "pending" }), true);
  assert.equal(retainIdempotencyAfter({ status: 409 }), false);
  assert.equal(retainIdempotencyAfter({ status: 402 }), false);
});
