// Every user-visible string of the desk lives here.
// The rules are docs/VOICE.md: the chrome speaks quietly to "you", never says
// "I", never mentions the machinery, and arrival is only ever ink on a page.

export const LANDING = {
  h1: "Everyone can generate.",
  h1Em: "Learn to write.",
  sub: "In the era of generated text, a sentence you wrote yourself is the signature. Bring a subject you care about; a coach reads deeply and responds — and never writes a word for you.",
  terms: "A paid monthly practice — one plan, cancel anytime. Delete individual pieces whenever you choose, or the whole account after the subscription ends.",
  sample: "Your coach brings material and questions — never the answer.",
};

export const FOOTER = [
  ["/pricing", "Pricing"],
  ["/privacy", "Privacy"],
];

export const ACCOUNT = {
  deleteAccount: "Delete your account",
  confirm: "Delete your account and everything in it — every piece, every letter, and your sign-in? This cannot be undone.",
};

export const SHELF = {
  question: "What are we writing today?",
  subjectPlaceholder: "A question, an argument, a letter you owe…",
  aimLabel: "Who is it for, and what should it do? (optional)",
  start: "Start with a reading",
  empty: "Each piece gets its own desk — the page, the reading, and the letters, kept as long as you need.",
  back: "Your pieces",
};

export const PAGE = {
  placeholder: "Begin anywhere, in your own words.",
  saved: "Saved.",
  saving: "Saving…",
  conflict: "This page changed in another tab. Choose which version to keep.",
  words: (count) => count === 1 ? "1 word" : `${count.toLocaleString("en-US")} words`,
};

// Note titles are chrome-derived, never model-generated.
export function envelopeTitle(note) {
  if (note.kind === "reading") return `Reading, round ${note.round}`;
  if (note.kind === "letter") return note.firstRead ? "A first read" : "On your draft";
  if (note.kind === "verdict") return "Where it stands";
  if (note.kind === "margin") return "Margin notes";
  if (note.kind === "reply") return "You wrote back";
  if (note.kind === "answer") return "An answer";
  return "Note";
}

// The stage card: what your coach is doing, or the last word it sent.
export const STAGE = {
  running: {
    reading: "Reading up on your subject…",
    letter: "Reading your draft. Step away if you like — a letter will be waiting.",
    verdict: "Reading the piece as it stands…",
  },
  failed: "That didn't go through. Ask again when you're ready — nothing was lost.",
  keepGoing: "Keep going — a paragraph is enough to ask for a first read.",
  editBrief: "Edit the brief",
  saveBrief: "Save the brief",
  history: "Correspondence",
};

// The starter card: somewhere to look, never something to paste. A chosen
// question lands in the ask box — for the coach, or to write into on the page.
export const OPENINGS = {
  waitingTitle: "Somewhere to look while your coach reads:",
  readingTitle: "From the reading — questions you could write into:",
  generic: [
    "What problem does this solve?",
    "What happens in one real case?",
    "What do people usually misunderstand about it?",
    "What cost or trade-off is easy to miss?",
    "Why did this become interesting to you?",
  ],
};

// The margin: notes underline their exact sentences on the page.
export const CARDS = {
  reading: "Reading your page…",
  hint: "Ask when you want notes pinned to exact passages on the page.",
};

export const ASKBOX = {
  label: "Ask your coach",
  placeholder: "Ask your coach about this piece…",
  send: "Ask",
  thinking: "Finding you an answer…",
  session: "One question uses one coach session.",
};

export const HISTORY = {
  back: "Back to the desk",
  empty: "Readings, letters, and answers will gather here.",
};

// Small screens show one surface at a time.
export const TABS = {
  page: "The page",
  coach: "Your coach",
};

export const VERBS = {
  letter: "Show this to your coach",
  letterHint: "A letter back: one strength, the one problem that matters, one move.",
  firstRead: "Ask for a first read",
  firstReadHint: "A short note back: what's alive, what a reader would ask next, one small next step.",
  verdict: "Ask where it stands",
  verdictHint: "Your coach reads the piece as it is now — and says plainly if it's ready.",
  verdictGate: "Change the page first — your coach has already read this version.",
  anotherReading: "Another round of reading",
  writeBack: "Write back",
  writeBackHint: "Answer in a line or two — it stays with the piece.",
  writeBackSend: "Send",
  asideLetter: "Set this one aside",
  deletePiece: "Delete this piece",
};

export const YOU_ASKED = "You asked";

export const MARGIN = {
  request: "Ask for margin notes",
  variantsLabel: "Reference — write it your way",
  overviewTitle: "On the whole piece",
  dismiss: "Dismiss note",
  categories: { structure: "Structure", clarity: "Clarity", correctness: "Correctness", comprehension: "Comprehension" },
};

export const STATUS = {
  subscriptionEnded: "The subscription is no longer active.",
  checkoutOpening: "Opening secure checkout…",
  checkoutConfirming: "Confirming the subscription with Polar…",
  checkoutPending: "Payment is not active yet. You can retry in a moment or manage the purchase through Polar.",
  checkoutUnconfigured: "Checkout is being configured. Your GitHub account is already registered.",
};

export function sessionsLeft(remaining) {
  return `${remaining} sessions left`;
}

export function planAllowance(monthlyAllowance) {
  return `${monthlyAllowance} coach sessions / month`;
}

export const CONFIRM_DELETE = "Delete this piece and everything on its desk — the page, the reading, and the letters?";

export const SHOW_ON_PAGE = "Show on the page";
