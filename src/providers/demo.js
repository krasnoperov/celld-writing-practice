import { FIRST_READ_WORDS } from "../piece-core.js";

function topicFromBrief(briefText) {
  return briefText?.match(/^Subject:\s*(.+)$/m)?.[1]?.trim()
    || briefText?.split("\n").map((value) => value.trim()).find(Boolean)
    || "your subject";
}

function words(markdown) {
  return markdown.split(/\s+/).filter(Boolean).length;
}

function demoResearch({ briefText, draftMarkdown }) {
  const topic = topicFromBrief(briefText);
  const firstLine = draftMarkdown?.split("\n").map((value) => value.trim()).find(Boolean)?.slice(0, 140) || "";
  return {
    note: firstLine
      ? `You wrote "${firstLine}" — and the material pushes on exactly that: the claims worth testing about ${topic} all carry a measurable cost. The sources disagree about who pays it, and that disagreement is where a piece finds its energy.`
      : `The most alive thing in the material on ${topic}: the claims worth writing about all carry a cost, and the sources disagree about who pays it. That disagreement — between what practitioners say and what outcomes show — is where a piece finds its energy.`,
    openings: [
      `Where does the cost of ${topic} actually land, and who notices it first?`,
      "What evidence would prove your current view wrong?",
      "Which single concrete case would you show a skeptical reader before any general claim?",
    ],
    full: `Before you draft, here are the questions I would take into the reading on ${topic}.

### The claim worth testing

The useful unit is not information about the subject but a claim that would change what your reader understands or does. I'd look first for evidence that could prove your opening assumption wrong.

### Where the disagreement lives

- What practitioners say they do, against what observable outcomes show.
- The obvious benefit, against the cost, constraint, or excluded group.
- The general claim, against one concrete case where it breaks.`,
  };
}

function demoFirstRead({ draftMarkdown }) {
  const firstSentence = draftMarkdown.split(/(?<=[.!?])\s+/)[0]?.slice(0, 180) || draftMarkdown.slice(0, 180);
  return `The most alive thing so far is "${firstSentence}" — a claim a reader can push against, in your own words. What that reader wants next is to see it happen once: one concrete case, plainly told. Write that case next, before explaining anything general.`;
}

function demoDraftFeedback({ draftMarkdown }) {
  const firstSentence = draftMarkdown.split(/(?<=[.!?])\s+/)[0]?.slice(0, 180) || draftMarkdown.slice(0, 180);
  return `The clearest sign this draft is yours is the opening: "${firstSentence}" — a real observation in your own words, worth protecting as you revise. What limits the draft right now is that a reader can follow your subject without being shown why it should matter to them; the observation arrives, but its consequence stays implicit, so a busy reader can nod and move on unchanged. Find the one place where a skeptical reader would ask "so what?" and revise that passage until the consequence is on the page, in your own words. Start there, and stop there.`;
}

function demoRevisionFeedback({ draftMarkdown }) {
  if (/because|which means|so that/i.test(draftMarkdown)) {
    return `This is ready. A reader now meets your observation and its consequence in the same breath — they leave knowing why it matters, not only that it is true. The principle at work — every claim pays its way in consequence — will serve your next piece just as well.`;
  }
  return `Not yet — and it is the same thing standing in the reader's way: they can follow the piece without being shown why it should change what they do. Find the place where a skeptical reader would shrug, and say what follows there, in your own words.`;
}

function demoAnswer({ briefText, question, draftMarkdown }) {
  const topic = topicFromBrief(briefText);
  if (draftMarkdown && /because|which means|so that/i.test(draftMarkdown)) {
    return `Your own page already leans toward an answer — you connect the claim to its consequence, and that is the ground "${question}" stands on. I'd test it against one concrete case of ${topic}: if the case survives, the question is settled for this piece; if it doesn't, that break is worth writing about.`;
  }
  return `Held against ${topic}, the honest answer to "${question}" is: it depends on a decision only you can make — who the reader is and what they should do differently after reading. Decide that first, and the question mostly answers itself; the evidence you'd need is one concrete case, not a survey.`;
}

function demoReview({ draftMarkdown, focusQuote }) {
  const sentences = draftMarkdown.split(/(?<=[.!?])\s+/).map((value) => value.trim()).filter((value) => value.length >= 20);
  const first = focusQuote?.trim() || sentences[0] || draftMarkdown.trim().slice(0, 120);
  const longest = focusQuote?.trim() || [...sentences].sort((left, right) => right.length - left.length)[0] || first;
  const firstClause = longest.split(/,\s+/)[0];
  return {
    overview: "The piece opens on observation rather than consequence: your main point is present, but a first-time reader has to assemble it. Consider whether the idea your reader should carry away could stand in the first paragraph, with the rest of the draft earning it.",
    cards: [
      {
        quote: "",
        category: "structure",
        note: "Pyramid order: state the conclusion first, then support it. Right now the draft builds toward its point; a busy reader may leave before arriving.",
        variants: [],
      },
      {
        quote: first,
        category: "comprehension",
        note: "This is the first thing your reader meets. Check that every term in it has been earned — anything they can't ground yet becomes a small toll at the gate.",
        variants: [],
      },
      {
        quote: longest,
        category: "clarity",
        note: "The longest sentence on the page. A reader holds all of it in mind at once; breaking it where the main verb lands would let them put something down.",
        variants: firstClause && firstClause.length < longest.length ? [`${firstClause}.`] : [],
      },
    ],
  };
}

export function createDemoProvider() {
  return {
    name: "demo",
    research: async (input) => demoResearch(input),
    analyzeDraft: async (input) => words(input.draftMarkdown) < FIRST_READ_WORDS ? demoFirstRead(input) : demoDraftFeedback(input),
    reviewRevision: async (input) => demoRevisionFeedback(input),
    review: async (input) => demoReview(input),
    answer: async (input) => demoAnswer(input),
  };
}
