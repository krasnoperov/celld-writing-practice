// Single reactive store for the desk. Components read this; all mutations go
// through actions.js.
import { anchorCard } from "../../../src/review-core.js";

export const app = $state({
  gate: "loading", // loading | signed-out | billing-gate | in
  user: null,
  billing: null,
  billingMessage: "",
  status: "",

  view: "shelf", // shelf | desk
  pieces: [],
  pieceId: null,
  piece: null, // publicState + brief from the piece cell

  editorText: "",
  doc: null, // { markdown, revision } — last saved page
  saveState: "saved", // saved | saving | dirty
  conflict: null, // { server, local }

  ask: "", // the ask box at the bottom of the coach's column
  pendingAsk: "", // the question in flight, echoed while the coach answers

  notes: [], // the stream, chronological
  sidebarView: "coach", // coach | history
  mobileView: "page", // page | coach — small screens show one at a time
  activeCard: null, // margin card index expanded in the sidebar
  hotCard: null, // margin card index under the pointer — fills its underline

  arrival: null, // { count, stagger, playing } — margin marks coming back
  lastInputAt: 0,
  pointRequest: null,
  isMobile: false, // kept current by a matchMedia listener in boot()
});

export function isDirty() {
  return Boolean(app.doc && app.editorText !== app.doc.markdown);
}

export function latestMargin() {
  return [...app.notes].reverse().find((note) => note.kind === "margin") ?? null;
}

// The latest document-level word from the coach — what the stage card shows.
export function latestDocNote() {
  return [...app.notes].reverse().find((note) => ["reading", "letter", "verdict"].includes(note.kind)) ?? null;
}

export function latestAnswer() {
  return [...app.notes].reverse().find((note) => note.kind === "answer") ?? null;
}

// Quote-anchored margin cards that still occur on the live page, in page
// order. A card whose sentence was rewritten simply leaves this list — the
// writer dealt with it.
export function spanCards() {
  const margin = latestMargin();
  if (!margin) return [];
  return margin.cards
    .map((card, index) => ({ card, index, anchor: card.quote ? anchorCard(card, app.editorText) : null }))
    .filter(({ card, anchor }) => !card.dismissed && card.quote && anchor)
    .map(({ card, index, anchor }) => ({ card, index, start: anchor.start }))
    .sort((left, right) => left.start - right.start);
}

// Whole-piece notes from the same pass: the overview plus quoteless cards.
export function wholePieceCards() {
  const margin = latestMargin();
  if (!margin) return [];
  return margin.cards
    .map((card, index) => ({ card, index }))
    .filter(({ card }) => !card.dismissed && !card.quote);
}

// ---- The gates, computed in one place. Call inside $derived. ----

export const MIN_DRAFT_CHARS = 80;
export const FIRST_READ_WORDS = 150; // mirrored from src/piece-core.js

export function coachBusy() {
  return Boolean(app.piece?.activeJob);
}

export function longEnough() {
  return app.editorText.trim().length >= MIN_DRAFT_CHARS;
}

// Below the threshold the letter arrives as a light first read.
export function firstReadDraft() {
  return app.editorText.split(/\s+/).filter(Boolean).length < FIRST_READ_WORDS;
}

export function verdictReady() {
  return Boolean(app.piece?.awaitingVerdict && app.doc && (isDirty() || app.doc.revision > app.piece.analyzedDraftRevision));
}

export function noteById(id) {
  return app.notes.find((note) => note.id === id) ?? null;
}
