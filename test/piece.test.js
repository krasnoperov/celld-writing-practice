import assert from "node:assert/strict";
import test from "node:test";
import { WritingCoach } from "../src/worker.js";
import { claimJob, completeJob, createPiece, nextDueJob } from "../src/piece-core.js";
import { createCoachProvider } from "../src/provider.js";

class FakeStorage {
  constructor() {
    this.values = new Map();
    this.alarmAt = null;
  }
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

function api(path, method = "GET", body, headers = {}) {
  const init = {
    method,
    headers: body === undefined ? headers : { "Content-Type": "application/json", ...headers },
  };
  if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
  return new Request(`http://example.test${path}`, init);
}

async function jsonPayload(response) {
  const value = await response.json();
  assert.ok(response.ok, JSON.stringify(value));
  return value;
}

const pieceInput = {
  subject: "Why AI coding tools sometimes move work instead of removing it",
  aim: "For experienced software engineers — explore where the hidden work appears.",
};

// Short enough for the first-read contract, long enough for the 80-char floor.
const fragment = "AI coding tools can make implementation feel immediate, but the work has not disappeared. Reviewers must reconstruct intent, verify unfamiliar choices, and detect plausible mistakes. The interesting measure is therefore not typing time alone.";

// Past FIRST_READ_WORDS, so letters use the full editorial contract.
const draft = `${fragment}

Consider a team that adopts an assistant for a quarter. Pull requests arrive faster and each one is longer, because generated scaffolding is cheap. The reviewers, who used to share context with the author by pairing on the hard parts, now meet code whose reasoning nobody in the room performed. They read more carefully, ask more questions, and request more changes, so the queue grows at exactly the stage the team did not instrument.

The claim is not that the tools fail. Authoring genuinely accelerates, and some verification can be automated. The claim is that the effort moves to places that are harder to see: review latency, rework after subtle mistakes, and the slow erosion of shared understanding that pairing used to provide. Any honest measurement of total delivery effort has to look at those places first, before it credits the time saved at the keyboard.`;

async function start(coach) {
  return jsonPayload(await coach.fetch(api("/api/piece", "POST", pieceInput)));
}

async function putDraft(coach, markdown, revision) {
  return coach.fetch(api("/api/docs/draft", "PUT", markdown, {
    "Content-Type": "text/markdown; charset=utf-8",
    "X-Document-Revision": String(revision),
  }));
}

async function stream(coach) {
  return (await jsonPayload(await coach.fetch(api("/api/stream")))).notes;
}

test("a background job is leased before outbound work and reclaimed after expiry", () => {
  const now = Date.now();
  const { state } = createPiece(pieceInput, now);
  const job = nextDueJob(state, now);
  assert.ok(job);
  assert.equal(claimJob(state, job.id, now, 5000).status, "running");
  assert.equal(nextDueJob(state, now + 1000), null);
  assert.equal(nextDueJob(state, now + 5001).id, job.id);
  assert.equal(claimJob(state, job.id, now + 5001, 5000).attempts, 2);
});

test("a new piece opens with an empty writable page and the first reading queued", async () => {
  const coach = new WritingCoach({ storage: new FakeStorage() }, { COACH_PROVIDER: "demo" });
  const piece = await start(coach);
  assert.equal(piece.activeJob.kind, "reading");
  assert.equal(piece.brief.subject, pieceInput.subject);
  const page = await coach.fetch(api("/api/docs/draft"));
  assert.equal(await page.text(), "");
  assert.equal(page.headers.get("X-Document-Revision"), "1");
  const saved = await putDraft(coach, draft, 1);
  assert.equal(saved.status, 204); // no lock, ever
});

test("the reading arrives as a note and survives object reconstruction", async () => {
  const storage = new FakeStorage();
  const first = new WritingCoach({ storage }, { COACH_PROVIDER: "demo" });
  await start(first);
  await first.alarm();
  const reconstructed = new WritingCoach({ storage }, { COACH_PROVIDER: "demo" });
  const notes = await stream(reconstructed);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].kind, "reading");
  assert.equal(notes[0].round, 1);
  assert.ok(notes[0].note.length > 40); // the short note the writer sees first
  assert.equal(notes[0].openings.length, 3); // questions to write into
  assert.match(notes[0].body, /The claim worth testing/); // the full reading, behind the fold
  assert.equal(notes[0].seenAt, null);
  const piece = await jsonPayload(await reconstructed.fetch(api("/api/piece")));
  assert.equal(piece.readingRounds, 1);
  assert.equal(piece.activeJob, null);
});

test("draft snapshots exist only while a queued or running job pins them", async () => {
  const storage = new FakeStorage();
  const coach = new WritingCoach({ storage }, { COACH_PROVIDER: "demo" });
  await start(coach);
  assert.equal(storage.values.get("history:draft:1").markdown, ""); // pinned by the first reading
  assert.equal((await putDraft(coach, draft, 1)).status, 204);
  assert.equal(storage.values.has("history:draft:2"), false); // saves alone never snapshot
  const stale = await putDraft(coach, `${draft} stale`, 1);
  assert.equal(stale.status, 412);

  await coach.alarm(); // reading settles; nothing pins revision 1 anymore
  assert.equal(storage.values.has("history:draft:1"), false);

  await jsonPayload(await coach.fetch(api("/api/actions/letter", "POST")));
  assert.equal(storage.values.get("history:draft:2").markdown, draft);
  await coach.alarm(); // letter settles; the verdict reads the page as it stands, so nothing stays pinned
  assert.equal(storage.values.has("history:draft:2"), false);

  assert.equal((await putDraft(coach, `${draft} revised for the letter.`, 2)).status, 204);
  await jsonPayload(await coach.fetch(api("/api/actions/verdict", "POST")));
  assert.equal(storage.values.has("history:draft:3"), true); // pinned while the verdict runs
  await coach.alarm(); // verdict settles; no snapshots remain at all
  assert.equal(storage.values.has("history:draft:3"), false);
});

test("one problem at a time: an unanswered letter blocks a fresh letter until aside or verdict", async () => {
  const storage = new FakeStorage();
  const coach = new WritingCoach({ storage }, { COACH_PROVIDER: "demo" });
  await start(coach);
  await coach.alarm();
  await putDraft(coach, draft, 1);
  await jsonPayload(await coach.fetch(api("/api/actions/letter", "POST")));
  await coach.alarm();

  const letter = (await stream(coach)).find((note) => note.kind === "letter");
  assert.ok(letter.body.length > 100);

  const blocked = await coach.fetch(api("/api/actions/letter", "POST"));
  assert.equal(blocked.status, 409);
  assert.match((await blocked.json()).error, /set it aside/i);

  await jsonPayload(await coach.fetch(api(`/api/notes/${letter.id}/aside`, "POST")));
  const afterAside = await jsonPayload(await coach.fetch(api("/api/piece")));
  assert.equal(afterAside.awaitingVerdict, false);
  assert.equal((await jsonPayload(await coach.fetch(api("/api/actions/letter", "POST")))).activeJob.kind, "letter");
});

test("a question for the coach rides on the request and comes back on the note", async () => {
  const storage = new FakeStorage();
  const coach = new WritingCoach({ storage }, { COACH_PROVIDER: "demo" });
  await start(coach);
  await coach.alarm();
  await putDraft(coach, draft, 1);

  const tooLong = await coach.fetch(api("/api/actions/letter", "POST", { ask: "x".repeat(501) }));
  assert.equal(tooLong.status, 400);

  await jsonPayload(await coach.fetch(api("/api/actions/letter", "POST", { ask: "Does the opening earn its length?" })));
  const state = await storage.get("piece");
  const queued = state.jobs.find((job) => job.kind === "letter");
  assert.equal(queued.ask, "Does the opening earn its length?");
  assert.match(queued.briefText, /^Subject: /); // the brief travels with the job, not by reference

  await coach.alarm();
  const letter = (await stream(coach)).find((note) => note.kind === "letter");
  assert.equal(letter.ask, "Does the opening earn its length?");
});

test("the verdict answers its letter, needs an advanced revision, and reads the writer's reply", async () => {
  const storage = new FakeStorage();
  const coach = new WritingCoach({ storage }, { COACH_PROVIDER: "demo" });
  await start(coach);
  await coach.alarm();
  await putDraft(coach, draft, 1);
  await jsonPayload(await coach.fetch(api("/api/actions/letter", "POST")));
  await coach.alarm();
  const letter = (await stream(coach)).find((note) => note.kind === "letter");

  const unchanged = await coach.fetch(api("/api/actions/verdict", "POST"));
  assert.equal(unchanged.status, 409);
  assert.match((await unchanged.json()).error, /already read this version/);

  const reply = await jsonPayload(await coach.fetch(api(`/api/notes/${letter.id}/reply`, "POST", { body: "I tried moving the consequence up front instead." })));
  assert.equal(reply.kind, "reply");
  assert.equal(reply.answersNoteId, letter.id);

  const revised = `${draft}\n\nThat shift matters because saved authoring time reappears as review latency.`;
  assert.equal((await putDraft(coach, revised, 2)).status, 204);
  await jsonPayload(await coach.fetch(api("/api/actions/verdict", "POST")));
  await coach.alarm();

  const notes = await stream(coach);
  const verdict = notes.find((note) => note.kind === "verdict");
  assert.equal(verdict.answersNoteId, letter.id);
  assert.match(verdict.body, /This is ready/); // forward-facing: the earned "ready", never a diff
  const piece = await jsonPayload(await coach.fetch(api("/api/piece")));
  assert.equal(piece.awaitingVerdict, false);
  assert.equal(piece.analyzedDraftRevision, 3);
});

test("a short draft gets a first read that never arms the verdict gate", async () => {
  const storage = new FakeStorage();
  const coach = new WritingCoach({ storage }, { COACH_PROVIDER: "demo" });
  await start(coach);
  await coach.alarm();
  await putDraft(coach, fragment, 1);
  await jsonPayload(await coach.fetch(api("/api/actions/letter", "POST")));
  await coach.alarm();

  const firstRead = (await stream(coach)).find((note) => note.kind === "letter");
  assert.equal(firstRead.firstRead, true);
  assert.match(firstRead.body, /most alive/);
  const piece = await jsonPayload(await coach.fetch(api("/api/piece")));
  assert.equal(piece.awaitingVerdict, false); // no letter gate, no verdict arming
  const aside = await coach.fetch(api(`/api/notes/${firstRead.id}/aside`, "POST"));
  assert.equal(aside.status, 400); // a first read never holds the gate, so there is nothing to set aside
  // …so the writer can simply ask again as the draft grows.
  assert.equal((await jsonPayload(await coach.fetch(api("/api/actions/letter", "POST")))).activeJob.kind, "letter");
});

test("notes carry read state and the reading limit holds", async () => {
  const storage = new FakeStorage();
  const coach = new WritingCoach({ storage }, { COACH_PROVIDER: "demo" });
  await start(coach);
  await coach.alarm();
  const [reading] = await stream(coach);
  const seen = await jsonPayload(await coach.fetch(api(`/api/notes/${reading.id}/seen`, "POST")));
  assert.ok(seen.seenAt);

  await jsonPayload(await coach.fetch(api("/api/actions/read", "POST")));
  await coach.alarm();
  await jsonPayload(await coach.fetch(api("/api/actions/read", "POST")));
  await coach.alarm();
  const exhausted = await coach.fetch(api("/api/actions/read", "POST"));
  assert.equal(exhausted.status, 409);
  assert.match((await exhausted.json()).error, /three is the limit/);
});

test("writing back is one reply per letter or verdict, never elsewhere", async () => {
  const storage = new FakeStorage();
  const coach = new WritingCoach({ storage }, { COACH_PROVIDER: "demo" });
  await start(coach);
  await coach.alarm();
  const reading = (await stream(coach)).find((note) => note.kind === "reading");
  const onReading = await coach.fetch(api(`/api/notes/${reading.id}/reply`, "POST", { body: "A note to myself." }));
  assert.equal(onReading.status, 400);

  await putDraft(coach, draft, 1);
  await jsonPayload(await coach.fetch(api("/api/actions/letter", "POST")));
  await coach.alarm();
  const letter = (await stream(coach)).find((note) => note.kind === "letter");
  await jsonPayload(await coach.fetch(api(`/api/notes/${letter.id}/reply`, "POST", { body: "First answer." })));
  const second = await coach.fetch(api(`/api/notes/${letter.id}/reply`, "POST", { body: "Second answer." }));
  assert.equal(second.status, 409);
});

test("a direct question gets an answer note, even on an empty page", async () => {
  const storage = new FakeStorage();
  const coach = new WritingCoach({ storage }, { COACH_PROVIDER: "demo" });
  await start(coach);
  await coach.alarm(); // the first reading settles

  const empty = await coach.fetch(api("/api/actions/answer", "POST", {}));
  assert.equal(empty.status, 400); // a question is the whole request

  const asked = await jsonPayload(await coach.fetch(api("/api/actions/answer", "POST", { ask: "Is this subject too broad for one piece?" })));
  assert.equal(asked.activeJob.kind, "answer");
  await coach.alarm();

  const answer = (await stream(coach)).find((note) => note.kind === "answer");
  assert.equal(answer.ask, "Is this subject too broad for one piece?");
  assert.match(answer.body, /Is this subject too broad for one piece\?/); // the demo answer echoes the question
  const piece = await jsonPayload(await coach.fetch(api("/api/piece")));
  assert.equal(piece.activeJob, null);
  assert.equal(piece.awaitingVerdict, false); // answers never touch the letter gate
});

test("settled jobs are pruned so the control record stays small", async () => {
  const now = Date.now();
  const { state } = createPiece(pieceInput, now);
  const job = nextDueJob(state, now);
  claimJob(state, job.id, now);
  for (let index = 0; index < 30; index += 1) {
    state.jobs.push({
      id: `job_old_${index}`, kind: "reading", status: "complete", inputRevisions: {},
      dueAt: 0, createdAt: 0, attempts: 1, lastError: "", leaseUntil: null, completedAt: 1,
    });
  }
  completeJob(state, job.id, now + 1);
  assert.ok(state.jobs.length <= 20);
  assert.ok(state.jobs.some((candidate) => candidate.id === job.id));
});

test("OpenAI web citations are made visible as clickable Markdown sources", async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = JSON.parse(init.body);
    return new Response(JSON.stringify({
      output: [{ content: [{
        type: "output_text",
        text: JSON.stringify({
          note: "The sharpest thing I found bears directly on what is already on your page.",
          openings: ["Where does the cost land first?", "What would prove you wrong?"],
          full: "### What the sources say\n\nA sourced observation.",
        }),
        annotations: [{ type: "url_citation", title: "Primary study", url: "https://example.test/study" }],
      }] }],
    }), { headers: { "Content-Type": "application/json" } });
  };
  try {
    const provider = createCoachProvider({ COACH_PROVIDER: "openai", OPENAI_API_KEY: "test", OPENAI_MODEL: "test-model" });
    const reading = await provider.research({ briefText: "Subject: X", earlierReadings: "", draftMarkdown: "", round: 1, writerAsk: "Where should the piece begin?" });
    assert.match(reading.full, /\[Primary study\]\(https:\/\/example\.test\/study\)/);
    assert.equal(reading.openings.length, 2);
    assert.equal(captured.text.format.name, "reading"); // structured reading rides with web search
    assert.match(captured.input[1].content, /THE WRITER ASKS[\s\S]*Where should the piece begin\?/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
