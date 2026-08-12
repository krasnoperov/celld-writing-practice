export const REVIEW_CATEGORIES = ["structure", "clarity", "correctness", "comprehension"];
const CATEGORY_SET = new Set(REVIEW_CATEGORIES);
const QUOTED_CATEGORIES = new Set(["clarity", "correctness"]);
const MAX_CARDS = 15;
const MAX_QUOTE = 300;
const MAX_NOTE = 1000;
const MAX_VARIANT = 300;
const MAX_VARIANTS = 2;

function clean(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

// Keeps only cards whose quoted anchor occurs verbatim in the draft the review
// was made against — a note pointing at text the writer never wrote is worse
// than no note at all.
export function validateReview(raw, draftMarkdown) {
  const cards = [];
  for (const candidate of Array.isArray(raw?.cards) ? raw.cards : []) {
    if (cards.length >= MAX_CARDS) break;
    const category = CATEGORY_SET.has(candidate?.category) ? candidate.category : null;
    const note = clean(candidate?.note, MAX_NOTE);
    if (!category || !note) continue;
    const quote = clean(candidate?.quote, MAX_QUOTE);
    if (quote && !draftMarkdown.includes(quote)) continue;
    if (!quote && QUOTED_CATEGORIES.has(category)) continue;
    const variants = (Array.isArray(candidate?.variants) ? candidate.variants : [])
      .map((variant) => clean(variant, MAX_VARIANT))
      .filter(Boolean)
      .slice(0, MAX_VARIANTS);
    cards.push({ quote, category, note, variants, dismissed: false });
  }
  return { overview: clean(raw?.overview, MAX_NOTE), cards };
}

// Exact-search re-anchor against the writer's current text. Returns the match
// range, or null when the page has moved on from under the note.
export function anchorCard(card, text) {
  if (!card.quote) return { start: null, end: null };
  const start = text.indexOf(card.quote);
  return start === -1 ? null : { start, end: start + card.quote.length };
}
