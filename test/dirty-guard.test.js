import assert from "node:assert/strict";
import test from "node:test";
import { flushPendingChanges, guardDirtyPage } from "../frontend/src/lib/dirty-guard.js";

test("pending changes are retried until the saved value catches up", async () => {
  let dirty = true;
  let saves = 0;
  const result = await flushPendingChanges({
    isDirty: () => dirty,
    isBlocked: () => false,
    save: async () => {
      saves += 1;
      if (saves === 2) dirty = false;
    },
  });
  assert.deepEqual(result, { saved: true, reason: null, attempts: 2 });
});

test("save failures propagate and blocked conflicts never navigate as saved", async () => {
  await assert.rejects(() => flushPendingChanges({
    isDirty: () => true,
    isBlocked: () => false,
    save: async () => { throw new Error("network down"); },
  }), /network down/);

  const blocked = await flushPendingChanges({
    isDirty: () => true,
    isBlocked: () => true,
    save: async () => assert.fail("a blocked conflict must not be saved again"),
  });
  assert.deepEqual(blocked, { saved: false, reason: "blocked", attempts: 0 });
});

test("beforeunload is guarded only while local text is dirty", () => {
  const clean = { prevented: false, preventDefault() { this.prevented = true; } };
  assert.equal(guardDirtyPage(clean, false), false);
  assert.equal(clean.prevented, false);

  const dirty = { prevented: false, returnValue: undefined, preventDefault() { this.prevented = true; } };
  assert.equal(guardDirtyPage(dirty, true), true);
  assert.equal(dirty.prevented, true);
  assert.equal(dirty.returnValue, "");
});
