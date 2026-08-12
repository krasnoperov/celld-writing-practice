import {
  applyLetter,
  applyReading,
  applyVerdict,
  asideLetter,
  briefText,
  claimJob,
  completeJob,
  createNote,
  createPiece,
  noteKey,
  nextAlarmAt,
  nextDueJob,
  pinnedDraftRevisions,
  publicState,
  queueAnswer,
  queueLetter,
  queueMargin,
  queueReading,
  queueVerdict,
  recordJobFailure,
  recordJobResult,
  updateBrief,
  updateDraft,
} from "./piece-core.js";
import { createCoachProvider } from "./provider.js";
import { PIECE_PROVIDER_ACTIONS } from "./action-policy.js";
import { errorResponse, httpError, json, readJson } from "./http.js";
import { validateReview } from "./review-core.js";
import { text } from "./validate.js";

const STATE_KEY = "piece";
const BRIEF_KEY = "brief";
const DRAFT_KEY = "doc:draft";
const SNAPSHOT_PREFIX = "history:draft:";
const MAX_CORRESPONDENCE_NOTES = 6;

function draftRevisionKey(revision) {
  return `${SNAPSHOT_PREFIX}${revision}`;
}

function markdownResponse(doc) {
  return new Response(doc.markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "X-Document-Revision": String(doc.revision),
      "Cache-Control": "no-store",
    },
  });
}

// Stream excerpts fed back to the model as context.
function readingsText(notes) {
  return notes.filter((note) => note.kind === "reading").map((note) => note.body).join("\n\n---\n\n");
}

function correspondenceText(notes) {
  const voices = { letter: "YOUR LETTER", verdict: "YOUR VERDICT", reply: "THE WRITER WROTE BACK", answer: "YOUR ANSWER" };
  return notes
    .filter((note) => voices[note.kind])
    .slice(-MAX_CORRESPONDENCE_NOTES)
    .map((note) => (note.kind === "answer"
      ? `THE WRITER ASKED: ${note.ask}\n${voices.answer}:\n${note.body}`
      : `${voices[note.kind]}:\n${note.body}`))
    .join("\n\n---\n\n");
}

const JOBS = {
  reading: {
    async run(coach, job, state, notes) {
      const draft = await coach.state.storage.get(draftRevisionKey(job.inputRevisions.draft));
      return coach.provider.research({
        briefText: job.briefText,
        earlierReadings: readingsText(notes),
        draftMarkdown: draft?.markdown?.trim() || "",
        round: state.readingRounds + 1,
        writerAsk: job.ask || "",
      });
    },
    async apply(coach, job, state, result, now) {
      // Three layers: a short note the writer sees first, questions to write
      // into, and the full cited reading behind a fold (body, so the later
      // prompts keep reading it as context).
      const note = createNote("reading", {
        round: state.readingRounds + 1,
        body: result.full,
        note: result.note,
        openings: (result.openings ?? []).filter((question) => typeof question === "string" && question.trim()).slice(0, 3),
        ask: job.ask || "",
        draftRevision: job.inputRevisions.draft,
      }, now, job.noteId);
      await coach.saveJobNote(note);
      applyReading(state, now);
    },
  },
  letter: {
    async run(coach, job, state, notes) {
      const draft = await coach.state.storage.get(draftRevisionKey(job.inputRevisions.draft));
      return coach.provider.analyzeDraft({
        briefText: job.briefText,
        readings: readingsText(notes),
        correspondence: correspondenceText(notes),
        draftMarkdown: draft.markdown,
        writerAsk: job.ask || "",
      });
    },
    async apply(coach, job, state, result, now) {
      const note = createNote("letter", {
        body: result,
        ask: job.ask || "",
        draftRevision: job.inputRevisions.draft,
        ...(job.firstRead ? { firstRead: true } : {}),
      }, now, job.noteId);
      await coach.saveJobNote(note);
      // A first read is encouragement, not an editorial contract: it never
      // arms the verdict gate and never blocks the next letter.
      if (job.firstRead) state.updatedAt = now;
      else applyLetter(state, note.id, job.inputRevisions.draft, now);
    },
  },
  verdict: {
    async run(coach, job, state, notes) {
      const draft = await coach.state.storage.get(draftRevisionKey(job.inputRevisions.draft));
      const letter = notes.find((note) => note.id === state.lastLetterNoteId);
      const reply = [...notes].reverse().find((note) => note.kind === "reply" && note.answersNoteId === state.lastLetterNoteId);
      return coach.provider.reviewRevision({
        briefText: job.briefText,
        readings: readingsText(notes),
        letterMarkdown: letter?.body ?? "",
        replyMarkdown: reply?.body ?? "",
        draftMarkdown: draft.markdown,
        writerAsk: job.ask || "",
      });
    },
    async apply(coach, job, state, result, now) {
      const note = createNote("verdict", {
        body: result,
        ask: job.ask || "",
        answersNoteId: state.lastLetterNoteId,
        draftRevision: job.inputRevisions.draft,
      }, now, job.noteId);
      await coach.saveJobNote(note);
      applyVerdict(state, job.inputRevisions.draft, now);
    },
  },
  answer: {
    async run(coach, job, state, notes) {
      const draft = await coach.state.storage.get(draftRevisionKey(job.inputRevisions.draft));
      return coach.provider.answer({
        briefText: job.briefText,
        readings: readingsText(notes),
        correspondence: correspondenceText(notes),
        draftMarkdown: draft?.markdown?.trim() || "",
        question: job.ask || "",
      });
    },
    async apply(coach, job, state, result, now) {
      const note = createNote("answer", {
        body: result,
        ask: job.ask || "",
        draftRevision: job.inputRevisions.draft,
      }, now, job.noteId);
      await coach.saveJobNote(note);
      state.updatedAt = now;
    },
  },
  margin: {
    async run(coach, job, state, notes) {
      const draft = await coach.state.storage.get(draftRevisionKey(job.inputRevisions.draft));
      return coach.provider.review({
        briefText: job.briefText,
        readings: readingsText(notes),
        correspondence: correspondenceText(notes),
        draftMarkdown: draft.markdown,
        focusQuote: job.focus || "",
        writerAsk: job.ask || "",
      });
    },
    async apply(coach, job, state, result, now) {
      const draft = await coach.state.storage.get(draftRevisionKey(job.inputRevisions.draft));
      const batch = validateReview(result, draft.markdown);
      const note = createNote("margin", {
        overview: batch.overview,
        cards: batch.cards,
        ask: job.ask || "",
        draftRevision: job.inputRevisions.draft,
      }, now, job.noteId);
      await coach.saveJobNote(note);
      state.updatedAt = now;
    },
  },
};

const ACTIONS = {
  read: (state, draft) => queueReading(state, draft.revision),
  letter: (state, draft) => queueLetter(state, draft.revision, draft.markdown),
  verdict: (state, draft) => queueVerdict(state, draft.revision, draft.markdown),
  margin: (state, draft, extras) => queueMargin(state, draft.revision, draft.markdown, extras?.focus ?? null),
  answer: (state, draft, extras) => queueAnswer(state, draft.revision, extras?.ask),
};

const configuredActions = Object.keys(ACTIONS);
if (configuredActions.length !== PIECE_PROVIDER_ACTIONS.length || configuredActions.some((action) => !PIECE_PROVIDER_ACTIONS.includes(action))) {
  throw new Error("Coach actions and the provider billing policy must match");
}

export class WritingCoach {
  constructor(state, env) {
    this.state = state;
    this.provider = createCoachProvider(env);
  }

  async loadState() {
    return (await this.state.storage.get(STATE_KEY)) ?? null;
  }

  async saveState(state) {
    await this.state.storage.put(STATE_KEY, state);
  }

  async loadBrief() {
    return this.state.storage.get(BRIEF_KEY);
  }

  async loadDraft() {
    return this.state.storage.get(DRAFT_KEY);
  }

  async saveDraft(doc) {
    await this.state.storage.put(DRAFT_KEY, doc);
  }

  // A snapshot exists only while a queued or running job pins it.
  async snapshotDraft(doc) {
    await this.state.storage.put(draftRevisionKey(doc.revision), doc);
  }

  async pruneSnapshots(state) {
    const pinned = pinnedDraftRevisions(state);
    const stored = await this.state.storage.list({ prefix: SNAPSHOT_PREFIX });
    for (const key of stored.keys()) {
      if (!pinned.has(Number(key.slice(SNAPSHOT_PREFIX.length)))) await this.state.storage.delete(key);
    }
  }

  async listNotes() {
    const map = await this.state.storage.list({ prefix: "note:" });
    return [...map.values()];
  }

  async loadNote(noteId) {
    const notes = await this.listNotes();
    const note = notes.find((candidate) => candidate.id === noteId);
    if (!note) throw httpError(404, "That note is not in the stream");
    return note;
  }

  async saveNote(note) {
    await this.state.storage.put(noteKey(note), note);
  }

  async saveJobNote(note) {
    const key = noteKey(note);
    if (!(await this.state.storage.get(key))) await this.state.storage.put(key, note);
  }

  async requirePiece() {
    const state = await this.loadState();
    if (!state) throw httpError(404, "Piece not found");
    return state;
  }

  async pieceResponse(state, status = 200) {
    const brief = await this.loadBrief();
    return json({ ...publicState(state), brief }, status);
  }

  async fetch(request) {
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/api/piece") {
        const state = await this.loadState();
        if (!state) return json(publicState(null));
        return this.pieceResponse(state);
      }

      if (request.method === "POST" && url.pathname === "/api/piece") {
        if (await this.loadState()) throw httpError(409, "This piece already exists");
        const { state, brief, draft } = createPiece(await readJson(request));
        await this.saveState(state);
        await this.state.storage.put(BRIEF_KEY, brief);
        await this.saveDraft(draft);
        await this.snapshotDraft(draft);
        await this.state.storage.setAlarm(Date.now());
        return json({ ...publicState(state), brief }, 202);
      }

      if (request.method === "DELETE" && url.pathname === "/api/piece") {
        await this.state.storage.deleteAll();
        if (this.state.storage.deleteAlarm) await this.state.storage.deleteAlarm();
        return json({ deleted: true });
      }

      if (request.method === "PUT" && url.pathname === "/api/brief") {
        const state = await this.requirePiece();
        const brief = await this.loadBrief();
        const updated = updateBrief(state, brief, await readJson(request));
        await this.state.storage.put(BRIEF_KEY, updated);
        await this.saveState(state);
        return this.pieceResponse(state);
      }

      if (url.pathname === "/api/docs/draft" && request.method === "GET") {
        await this.requirePiece();
        return markdownResponse(await this.loadDraft());
      }

      if (url.pathname === "/api/docs/draft" && request.method === "PUT") {
        const contentType = request.headers.get("Content-Type") || "";
        if (!contentType.toLowerCase().startsWith("text/markdown")) {
          throw httpError(415, "Page writes require Content-Type: text/markdown");
        }
        const state = await this.requirePiece();
        const current = await this.loadDraft();
        const expectedRevision = Number(request.headers.get("X-Document-Revision"));
        if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
          throw httpError(428, "X-Document-Revision is required");
        }
        if (expectedRevision !== current.revision) {
          throw httpError(412, "This page changed somewhere else — choose which version to keep.");
        }
        const updated = updateDraft(state, current, await request.text());
        await this.saveDraft(updated);
        await this.saveState(state);
        return new Response(null, { status: 204, headers: { "X-Document-Revision": String(updated.revision) } });
      }

      if (request.method === "GET" && url.pathname === "/api/stream") {
        await this.requirePiece();
        return json({ notes: await this.listNotes() });
      }

      const noteMatch = url.pathname.match(/^\/api\/notes\/([a-z0-9_-]+)\/(seen|aside|reply|dismiss)$/);
      if (noteMatch && request.method === "POST") {
        const state = await this.requirePiece();
        const note = await this.loadNote(noteMatch[1]);
        const now = Date.now();
        if (noteMatch[2] === "seen") {
          if (!note.seenAt) {
            note.seenAt = now;
            await this.saveNote(note);
          }
          return json(note);
        }
        if (noteMatch[2] === "aside") {
          // Only the outstanding letter holds the gate; a first read never does.
          if (note.kind !== "letter" || note.firstRead) throw httpError(400, "Only a letter can be set aside");
          asideLetter(state, note.id, now);
          await this.saveState(state);
          await this.pruneSnapshots(state);
          return this.pieceResponse(state);
        }
        if (noteMatch[2] === "dismiss") {
          if (note.kind !== "margin") throw httpError(400, "Only margin notes can be dismissed");
          const { index } = await readJson(request);
          if (!Number.isInteger(index) || index < 0 || index >= note.cards.length) {
            throw httpError(400, "Unknown margin note");
          }
          note.cards[index].dismissed = true;
          await this.saveNote(note);
          return json(note);
        }
        // reply — writer prose, never a model call
        if (note.kind !== "letter" && note.kind !== "verdict") {
          throw httpError(400, "Write back under a letter or a verdict.");
        }
        const notes = await this.listNotes();
        if (notes.some((candidate) => candidate.kind === "reply" && candidate.answersNoteId === note.id)) {
          throw httpError(409, "You've already written back to this one.");
        }
        const input = await readJson(request);
        const body = text(input.body, "reply", { min: 1, max: 4000 });
        const draft = await this.loadDraft();
        const reply = createNote("reply", {
          body,
          answersNoteId: note.id,
          draftRevision: draft.revision,
          seenAt: now,
        }, now);
        await this.saveNote(reply);
        state.updatedAt = now;
        await this.saveState(state);
        return json(reply);
      }

      const actionMatch = url.pathname.match(/^\/api\/actions\/(read|letter|verdict|margin|answer)$/);
      if (actionMatch && request.method === "POST") {
        const state = await this.requirePiece();
        const draft = await this.loadDraft();
        const brief = await this.loadBrief();
        const extras = await request.json().catch(() => ({}));
        // The writer may send a question along with any request; it rides on
        // the job and comes back stamped on the note that answers it.
        const ask = typeof extras?.ask === "string" && extras.ask.trim()
          ? text(extras.ask, "question", { min: 1, max: 500 })
          : "";
        const job = ACTIONS[actionMatch[1]](state, draft, extras);
        job.briefText = briefText(brief);
        if (ask) job.ask = ask;
        await this.snapshotDraft(draft);
        await this.saveState(state);
        await this.state.storage.setAlarm(Date.now());
        return this.pieceResponse(state, 202);
      }

      throw httpError(404, "Route not found");
    } catch (error) {
      return errorResponse(error);
    }
  }

  async alarm() {
    let state = await this.loadState();
    if (!state) return;
    const job = nextDueJob(state);
    if (!job) {
      const nextAt = nextAlarmAt(state);
      if (nextAt) await this.state.storage.setAlarm(nextAt);
      return;
    }

    const claimed = claimJob(state, job.id);
    if (!claimed) return;
    const leaseUntil = claimed.leaseUntil;
    await this.saveState(state);
    await this.state.storage.setAlarm(leaseUntil);

    const kind = JOBS[job.kind];
    try {
      if (!kind) throw new Error(`Unknown job kind: ${job.kind}`);
      let result = claimed.result;
      if (!result) {
        const notes = await this.listNotes();
        const output = await kind.run(this, job, state, notes);

        state = await this.loadState();
        const liveJob = state?.jobs.find((candidate) => candidate.id === job.id);
        if (!state || liveJob?.status !== "running" || liveJob.leaseUntil !== leaseUntil) return;
        result = recordJobResult(state, job.id, output);
        await this.saveState(state);
      }

      state = await this.loadState();
      const liveJob = state?.jobs.find((candidate) => candidate.id === job.id);
      if (!state || liveJob?.status !== "running" || liveJob.leaseUntil !== leaseUntil) return;
      await kind.apply(this, liveJob, state, result.output, result.receivedAt);
      const now = Date.now();
      completeJob(state, job.id, now);
      await this.saveState(state);
      await this.pruneSnapshots(state);
    } catch {
      state = await this.loadState();
      const liveJob = state?.jobs.find((candidate) => candidate.id === job.id);
      if (!state || liveJob?.status !== "running" || liveJob.leaseUntil !== leaseUntil) return;
      recordJobFailure(state, job.id);
      await this.saveState(state);
      if (state.jobs.find((candidate) => candidate.id === job.id)?.status === "failed") {
        await this.pruneSnapshots(state);
      }
    }

    const nextAt = nextAlarmAt(state);
    if (nextAt) await this.state.storage.setAlarm(nextAt);
  }
}
