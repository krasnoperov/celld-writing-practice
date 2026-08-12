import { httpError } from "./http.js";
import { text } from "./validate.js";

const MAX_SETTLED_JOBS = 20;
const MAX_READING_ROUNDS = 3;
const MIN_DRAFT_CHARS = 80;
const MAX_DRAFT_CHARS = 80_000;

// Below this, a letter arrives as a light "first read" instead of the full
// editorial contract. Mirrored in frontend/src/lib/state.svelte.js.
export const FIRST_READ_WORDS = 150;

function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function cleanBrief(input) {
  const subject = text(input.subject, "subject", { min: 3, max: 500 });
  const aim = typeof input.aim === "string" && input.aim.trim() ? text(input.aim, "aim", { min: 1, max: 500 }) : "";
  return { subject, aim };
}

export function briefText(brief) {
  return brief.aim ? `Subject: ${brief.subject}\nAim: ${brief.aim}` : `Subject: ${brief.subject}`;
}

function enqueueJob(state, kind, inputRevisions, now) {
  if (state.jobs.some((job) => job.status !== "complete" && job.status !== "failed")) {
    throw httpError(409, "Your coach is still working — give it a moment.");
  }
  const job = {
    id: id("job"),
    noteId: id("note"),
    kind,
    inputRevisions: { ...inputRevisions },
    dueAt: now,
    status: "pending",
    attempts: 0,
    leaseUntil: null,
    createdAt: now,
    completedAt: null,
  };
  state.jobs.push(job);
  state.updatedAt = now;
  return job;
}

function pruneSettledJobs(state) {
  const settled = state.jobs
    .filter((job) => job.status === "complete" || job.status === "failed")
    .sort((left, right) => (left.completedAt ?? left.createdAt) - (right.completedAt ?? right.createdAt));
  if (settled.length <= MAX_SETTLED_JOBS) return;
  const drop = new Set(settled.slice(0, settled.length - MAX_SETTLED_JOBS).map((job) => job.id));
  state.jobs = state.jobs.filter((job) => !drop.has(job.id));
}

// A new piece: an empty, always-writable page, a brief, and the first
// reading already on its way. No phases, no locks.
export function createPiece(input, now = Date.now()) {
  const brief = { ...cleanBrief(input), revision: 1, updatedAt: now };
  const draft = { markdown: "", revision: 1, updatedAt: now };
  const state = {
    readingRounds: 0,
    lastLetterNoteId: null,
    analyzedDraftRevision: null,
    jobs: [],
    createdAt: now,
    updatedAt: now,
  };
  const job = enqueueJob(state, "reading", { draft: 1 }, now);
  job.briefText = briefText(brief);
  return { state, brief, draft };
}

export function publicState(state) {
  if (!state) return { exists: false };
  const activeJob = state.jobs.find((job) => job.status === "pending" || job.status === "running");
  const failedJob = [...state.jobs].reverse().find((job) => job.status === "failed");
  return {
    exists: true,
    readingRounds: state.readingRounds,
    maxReadingRounds: MAX_READING_ROUNDS,
    analyzedDraftRevision: state.analyzedDraftRevision,
    awaitingVerdict: Boolean(state.lastLetterNoteId),
    lastLetterNoteId: state.lastLetterNoteId,
    activeJob: activeJob ? { id: activeJob.id, kind: activeJob.kind, status: activeJob.status, attempts: activeJob.attempts } : null,
    failedJob: failedJob ? { kind: failedJob.kind, attempts: failedJob.attempts } : null,
    updatedAt: state.updatedAt,
  };
}

export function updateBrief(state, brief, input, now = Date.now()) {
  const next = { ...cleanBrief(input), revision: brief.revision + 1, updatedAt: now };
  state.updatedAt = now;
  return next;
}

export function updateDraft(state, current, markdown, now = Date.now()) {
  if (typeof markdown !== "string") throw httpError(400, "The page body must be text");
  if (markdown.length > MAX_DRAFT_CHARS) throw httpError(400, "The page is too large");
  const next = { ...current, markdown, revision: current.revision + 1, updatedAt: now };
  state.updatedAt = now;
  return next;
}

function requireDraft(draftMarkdown) {
  if (typeof draftMarkdown !== "string" || draftMarkdown.trim().length < MIN_DRAFT_CHARS) {
    throw httpError(400, "Write a little more first — a very short draft doesn't give your coach enough to respond to.");
  }
}

// ---- The gates: small facts instead of a corridor of phases. ----

export function queueReading(state, draftRevision, now = Date.now()) {
  if (state.readingRounds >= MAX_READING_ROUNDS) {
    throw httpError(409, "That was the last round of reading for this piece — three is the limit.");
  }
  return enqueueJob(state, "reading", { draft: draftRevision }, now);
}

export function queueLetter(state, draftRevision, draftMarkdown, now = Date.now()) {
  requireDraft(draftMarkdown);
  if (state.lastLetterNoteId) {
    throw httpError(409, "There's a letter waiting on your revision. Answer it, or set it aside first.");
  }
  const job = enqueueJob(state, "letter", { draft: draftRevision }, now);
  if (draftMarkdown.split(/\s+/).filter(Boolean).length < FIRST_READ_WORDS) job.firstRead = true;
  return job;
}

export function queueVerdict(state, draftRevision, draftMarkdown, now = Date.now()) {
  requireDraft(draftMarkdown);
  if (!state.lastLetterNoteId) throw httpError(409, "There's no letter waiting on a revision right now.");
  if (!state.analyzedDraftRevision || draftRevision <= state.analyzedDraftRevision) {
    throw httpError(409, "Change the page first — your coach has already read this version.");
  }
  return enqueueJob(state, "verdict", { draft: draftRevision }, now);
}

// A direct question needs no draft at all — the coach answers from the brief,
// the readings, and whatever is on the page.
export function queueAnswer(state, draftRevision, question, now = Date.now()) {
  const ask = text(question, "question", { min: 1, max: 500 });
  const job = enqueueJob(state, "answer", { draft: draftRevision }, now);
  job.ask = ask;
  return job;
}

export function queueMargin(state, draftRevision, draftMarkdown, focus = null, now = Date.now()) {
  requireDraft(draftMarkdown);
  if (focus !== null) {
    if (typeof focus !== "string" || !focus.trim() || !draftMarkdown.includes(focus)) {
      throw httpError(400, "Select text that is still on the page.");
    }
  }
  const job = enqueueJob(state, "margin", { draft: draftRevision }, now);
  if (focus) job.focus = focus;
  return job;
}

// ---- Applying results: each pass becomes a note in the stream. ----

export function applyReading(state, now = Date.now()) {
  state.readingRounds += 1;
  state.updatedAt = now;
}

export function applyLetter(state, noteId, draftRevision, now = Date.now()) {
  state.lastLetterNoteId = noteId;
  state.analyzedDraftRevision = draftRevision;
  state.updatedAt = now;
}

export function applyVerdict(state, draftRevision, now = Date.now()) {
  state.lastLetterNoteId = null;
  state.analyzedDraftRevision = draftRevision;
  state.updatedAt = now;
}

export function asideLetter(state, noteId, now = Date.now()) {
  if (state.lastLetterNoteId === noteId) state.lastLetterNoteId = null;
  state.updatedAt = now;
}

// ---- Notes ----

export function createNote(kind, fields, now = Date.now(), noteId = id("note")) {
  return {
    id: noteId,
    kind,
    createdAt: now,
    seenAt: null,
    ...fields,
  };
}

export function noteKey(note) {
  return `note:${String(note.createdAt).padStart(14, "0")}:${note.id}`;
}

// ---- Snapshot pinning: only drafts an active job still needs are kept.
// The verdict reads the current page fresh; it never revisits an old draft. ----

export function pinnedDraftRevisions(state) {
  const pinned = new Set();
  for (const job of state.jobs) {
    if (job.status === "pending" || job.status === "running") pinned.add(job.inputRevisions.draft);
  }
  return pinned;
}

// ---- Job runner plumbing (unchanged mechanics). ----

export function nextDueJob(state, now = Date.now()) {
  return state.jobs
    .filter((job) => (job.status === "pending" && job.dueAt <= now) || (job.status === "running" && job.leaseUntil <= now))
    .sort((left, right) => left.dueAt - right.dueAt || left.createdAt - right.createdAt)[0] ?? null;
}

export function nextAlarmAt(state) {
  const times = state.jobs
    .filter((job) => job.status === "pending" || job.status === "running")
    .map((job) => job.status === "running" ? job.leaseUntil : job.dueAt);
  return times.length ? Math.min(...times) : null;
}

export function claimJob(state, jobId, now = Date.now(), leaseMs = 5 * 60_000) {
  const job = state.jobs.find((candidate) => candidate.id === jobId);
  if (!job || !["pending", "running"].includes(job.status)) return null;
  if (job.status === "running" && job.leaseUntil > now) return null;
  job.status = "running";
  job.leaseUntil = now + leaseMs;
  job.attempts += 1;
  state.updatedAt = now;
  return job;
}

// Once outbound work returns, keep its exact output on the leased job until
// the note and state transition have both been committed. Alarm retries can
// then finish applying the same result without calling the provider again.
export function recordJobResult(state, jobId, output, now = Date.now()) {
  const job = state.jobs.find((candidate) => candidate.id === jobId);
  if (!job || job.status !== "running") return null;
  if (!job.result) job.result = { output, receivedAt: now };
  state.updatedAt = now;
  return job.result;
}

export function completeJob(state, jobId, now = Date.now()) {
  const job = state.jobs.find((candidate) => candidate.id === jobId);
  if (!job) throw new Error("Job not found");
  delete job.result;
  job.status = "complete";
  job.leaseUntil = null;
  job.completedAt = now;
  state.updatedAt = now;
  pruneSettledJobs(state);
}

export function recordJobFailure(state, jobId, now = Date.now(), maxAttempts = 3) {
  const job = state.jobs.find((candidate) => candidate.id === jobId);
  if (!job) return;
  job.leaseUntil = null;
  if (job.attempts >= maxAttempts) {
    delete job.result;
    job.status = "failed";
    job.completedAt = now;
    pruneSettledJobs(state);
  } else {
    job.status = "pending";
    job.dueAt = now + Math.min(60_000, 1000 * (2 ** job.attempts));
  }
  state.updatedAt = now;
}
