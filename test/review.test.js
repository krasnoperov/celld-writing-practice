import assert from "node:assert/strict";
import test from "node:test";
import { anchorCard, validateReview } from "../src/review-core.js";
import { WritingCoach } from "../src/worker.js";
import { createPiece, queueMargin } from "../src/piece-core.js";

const draft = "AI coding tools can make implementation feel immediate, but the work has not disappeared. Reviewers must reconstruct intent, verify unfamiliar choices, and detect plausible mistakes. The interesting measure is therefore not typing time alone.";

test("validation drops hallucinated quotes and quoteless sentence-level notes", () => {
  const batch = validateReview({
    overview: "A fair overview.",
    cards: [
      { quote: "Reviewers must reconstruct intent", category: "clarity", note: "Real anchor.", variants: ["One", "Two", "Three"] },
      { quote: "This text does not exist in the draft", category: "correctness", note: "Hallucinated anchor.", variants: [] },
      { quote: "", category: "clarity", note: "Clarity requires a quote.", variants: [] },
      { quote: "", category: "structure", note: "Whole-piece notes may omit the quote.", variants: [] },
      { quote: "typing time", category: "invented-category", note: "Unknown category.", variants: [] },
    ],
  }, draft);
  assert.equal(batch.overview, "A fair overview.");
  assert.deepEqual(batch.cards.map((card) => card.category), ["clarity", "structure"]);
  assert.equal(batch.cards[0].variants.length, 2);
});

test("anchoring finds exact spans and reports moved-on text", () => {
  const card = { quote: "verify unfamiliar choices" };
  const anchor = anchorCard(card, draft);
  assert.equal(draft.slice(anchor.start, anchor.end), "verify unfamiliar choices");
  assert.equal(anchorCard(card, "A different draft entirely."), null);
  assert.deepEqual(anchorCard({ quote: "" }, draft), { start: null, end: null });
});

test("a margin pass needs a substantial page and a free coach", () => {
  const { state } = createPiece({ subject: "A real subject worth writing about" }, 1);
  assert.throws(() => queueMargin(state, 1, "too short"), /a very short draft/);
  assert.throws(() => queueMargin(state, 1, draft), /still working/);
});

class FakeStorage {
  constructor() {
    this.values = new Map();
    this.alarmAt = null;
    this.afterPut = null;
    this.putKeys = [];
  }
  async get(key) { return structuredClone(this.values.get(key)); }
  async put(key, value) {
    this.values.set(key, structuredClone(value));
    this.putKeys.push(key);
    if (this.afterPut?.(key, value)) {
      this.afterPut = null;
      throw new Error("simulated crash after durable write");
    }
  }
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

async function retryNow(storage) {
  const state = await storage.get("piece");
  const job = state.jobs.find((candidate) => candidate.status === "pending");
  assert.ok(job, "failed alarm returned the job to its pending state");
  job.dueAt = 0;
  await storage.put("piece", state);
}

function api(path, method = "GET", body) {
  const init = {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request(`http://example.test${path}`, init);
}

async function jsonPayload(response) {
  const value = await response.json();
  assert.ok(response.ok, JSON.stringify(value));
  return value;
}

async function readyCoach() {
  const storage = new FakeStorage();
  const coach = new WritingCoach({ storage }, { COACH_PROVIDER: "demo" });
  await jsonPayload(await coach.fetch(api("/api/piece", "POST", { subject: "AI coding tools and hidden review work" })));
  await coach.alarm();
  await coach.fetch(new Request("http://example.test/api/docs/draft", {
    method: "PUT",
    headers: { "Content-Type": "text/markdown", "X-Document-Revision": "1" },
    body: draft,
  }));
  return { storage, coach };
}

test("margin notes arrive as a stream note, anchor to the page, and record dismissals", async () => {
  const { storage, coach } = await readyCoach();
  await jsonPayload(await coach.fetch(api("/api/actions/margin", "POST")));
  await coach.alarm();

  const { notes } = await jsonPayload(await coach.fetch(api("/api/stream")));
  const margin = notes.find((note) => note.kind === "margin");
  assert.ok(margin.cards.length >= 2);
  for (const card of margin.cards.filter((value) => value.quote)) {
    assert.ok(draft.includes(card.quote), `anchor not found: ${card.quote}`);
  }

  await jsonPayload(await coach.fetch(api(`/api/notes/${margin.id}/dismiss`, "POST", { index: 0 })));
  const reloaded = new WritingCoach({ storage }, { COACH_PROVIDER: "demo" });
  const { notes: after } = await jsonPayload(await reloaded.fetch(api("/api/stream")));
  assert.equal(after.find((note) => note.kind === "margin").cards[0].dismissed, true);
});

test("a focused pass anchors to the pointed passage and rejects text not on the page", async () => {
  const { coach } = await readyCoach();
  const rejected = await coach.fetch(api("/api/actions/margin", "POST", { focus: "text that is not on the page" }));
  assert.equal(rejected.status, 400);
  assert.match((await rejected.json()).error, /still on the page/);

  const focus = "Reviewers must reconstruct intent, verify unfamiliar choices, and detect plausible mistakes.";
  await jsonPayload(await coach.fetch(api("/api/actions/margin", "POST", { focus })));
  await coach.alarm();
  const { notes } = await jsonPayload(await coach.fetch(api("/api/stream")));
  const margin = notes.find((note) => note.kind === "margin");
  assert.ok(margin.cards.some((card) => card.quote === focus), "a note anchors to the pointed passage");
});

test("an alarm retry reuses the provider result committed before a crash", async () => {
  const storage = new FakeStorage();
  const coach = new WritingCoach({ storage }, { COACH_PROVIDER: "demo" });
  await jsonPayload(await coach.fetch(api("/api/piece", "POST", { subject: "AI coding tools and hidden review work" })));

  const research = coach.provider.research;
  let providerCalls = 0;
  coach.provider.research = async (...args) => {
    providerCalls += 1;
    return research(...args);
  };
  storage.afterPut = (key, value) => key === "piece" && value.jobs.some((job) => job.result);

  await coach.alarm();
  const interrupted = await storage.get("piece");
  assert.equal(interrupted.jobs[0].status, "pending");
  assert.ok(interrupted.jobs[0].result, "the returned provider output is durable before note application");
  assert.equal((await storage.list({ prefix: "note:" })).size, 0);

  await retryNow(storage);
  await coach.alarm();

  const settled = await storage.get("piece");
  const notes = await storage.list({ prefix: "note:" });
  assert.equal(providerCalls, 1);
  assert.equal(notes.size, 1);
  assert.equal(settled.readingRounds, 1);
  assert.equal(settled.jobs[0].status, "complete");
  assert.equal(settled.jobs[0].result, undefined);
});

test("an alarm retry reuses the same job note after a crash window", async () => {
  const storage = new FakeStorage();
  const coach = new WritingCoach({ storage }, { COACH_PROVIDER: "demo" });
  await jsonPayload(await coach.fetch(api("/api/piece", "POST", { subject: "AI coding tools and hidden review work" })));
  const queued = await storage.get("piece");
  const noteId = queued.jobs[0].noteId;

  const research = coach.provider.research;
  let providerCalls = 0;
  coach.provider.research = async (...args) => {
    providerCalls += 1;
    return research(...args);
  };
  storage.afterPut = (key, value) => key.startsWith("note:") && value.kind === "reading";

  await coach.alarm();
  const interruptedNotes = await storage.list({ prefix: "note:" });
  assert.equal(interruptedNotes.size, 1, "the note write reached durable storage");
  const [noteKey] = interruptedNotes.keys();
  const seenNote = interruptedNotes.get(noteKey);
  seenNote.seenAt = 123;
  await storage.put(noteKey, seenNote);
  const writesBeforeRetry = storage.putKeys.filter((key) => key.startsWith("note:")).length;
  await retryNow(storage);
  await coach.alarm();

  const settled = await storage.get("piece");
  const notes = await storage.list({ prefix: "note:" });
  const noteWrites = storage.putKeys.filter((key) => key.startsWith("note:"));
  assert.equal(providerCalls, 1);
  assert.equal(notes.size, 1);
  assert.equal(noteWrites.length, writesBeforeRetry, "the retry does not overwrite the durable note");
  assert.equal([...notes.values()][0].id, noteId);
  assert.equal([...notes.values()][0].seenAt, 123, "interaction with the durable note is preserved");
  assert.equal(settled.readingRounds, 1);
  assert.equal(settled.jobs[0].status, "complete");
});
