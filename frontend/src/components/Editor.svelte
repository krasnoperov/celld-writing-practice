<script>
  import { anchorCard } from "../../../src/review-core.js";
  import { escapeHtml } from "../lib/markdown.js";
  import { app, latestMargin } from "../lib/state.svelte.js";
  import { completeArrival, pageEdited } from "../lib/actions.js";
  import { PAGE } from "../lib/copy.js";

  const QUIET_MS = 3000;

  let textarea = $state(null);
  let backdrop = $state(null);
  let coachHand = $state(false);
  let quietTimer = null;
  let playTimer = null;
  let lastPointSeq = null;

  // The coach's marks live in the text itself: every live margin note is a
  // dotted underline under the exact span it annotates.
  const marks = $derived.by(() => {
    const text = app.editorText;
    const ranges = [];
    const margin = latestMargin();
    if (margin) {
      margin.cards.forEach((card, index) => {
        if (card.dismissed || !card.quote) return;
        const anchor = anchorCard(card, text);
        if (anchor && anchor.start !== null) ranges.push({ ...anchor, index });
      });
    }
    ranges.sort((left, right) => left.start - right.start);
    return ranges.filter((range, i) => i === 0 || range.start >= ranges[i - 1].end);
  });

  const backdropHtml = $derived.by(() => {
    const text = app.editorText;
    let html = "";
    let cursor = 0;
    let order = 0;
    for (const range of marks) {
      html += escapeHtml(text.slice(cursor, range.start));
      const hot = range.index === app.hotCard || range.index === app.activeCard;
      html += `<mark data-note="${range.index}" style="--i:${order}"${hot ? ' class="hot"' : ""}>${escapeHtml(text.slice(range.start, range.end))}</mark>`;
      cursor = range.end;
      order += 1;
    }
    return html + escapeHtml(text.slice(cursor)) + "\n";
  });

  // The marked page comes back only to a quiet hand.
  $effect(() => {
    if (!app.arrival || app.arrival.playing) return;
    const tryPlay = () => {
      if (!app.arrival) return;
      const since = Date.now() - app.lastInputAt;
      if (since < QUIET_MS) {
        quietTimer = setTimeout(tryPlay, QUIET_MS - since + 50);
        return;
      }
      app.arrival.playing = true;
      const total = app.arrival.count * app.arrival.stagger + 700;
      playTimer = setTimeout(() => completeArrival(), total);
    };
    tryPlay();
    return () => { clearTimeout(quietTimer); };
  });

  function oninput() {
    pageEdited();
    coachHand = false;
    if (app.arrival) {
      clearTimeout(playTimer);
      completeArrival();
    }
  }

  function onscroll() {
    if (backdrop) backdrop.scrollTop = textarea.scrollTop;
  }

  function onpointerdown() {
    coachHand = false;
  }

  // Click an underline, meet its note: a caret landing inside a marked span
  // opens that card in the coach's column; landing elsewhere lets it close.
  function onclick() {
    if (textarea.selectionStart !== textarea.selectionEnd) return;
    const caret = textarea.selectionStart;
    const hit = marks.find((range) => caret >= range.start && caret <= range.end);
    app.activeCard = hit ? hit.index : null;
    if (hit) app.sidebarView = "coach";
  }

  // The coach's hand: point at a span on the coach's behalf. Each request
  // points exactly once — the effect also reruns when the page text changes,
  // and re-pointing then would steal the caret from a writer who kept typing.
  $effect(() => {
    const request = app.pointRequest;
    if (!request || !textarea || request.seq === lastPointSeq) return;
    lastPointSeq = request.seq;
    const anchor = anchorCard({ quote: request.quote }, app.editorText);
    if (!anchor || anchor.start === null) return;
    textarea.focus();
    textarea.setSelectionRange(anchor.start, anchor.end);
    coachHand = true;
    const mark = backdrop?.querySelector(`mark[data-note="${request.index ?? ""}"]`)
      ?? [...(backdrop?.querySelectorAll("mark") ?? [])].find((m) => m.textContent === app.editorText.slice(anchor.start, anchor.end));
    if (mark) {
      textarea.scrollTop = Math.max(0, mark.offsetTop - textarea.clientHeight / 3);
      mark.classList.add("breathe");
      setTimeout(() => mark.classList.remove("breathe"), 350);
    } else {
      textarea.scrollTop = Math.max(0, (anchor.start / Math.max(1, app.editorText.length)) * textarea.scrollHeight - textarea.clientHeight / 3);
    }
  });
</script>

<div class="editor-stack" class:coach-hand={coachHand}>
  <div
    class="editor-backdrop"
    class:arriving={app.arrival?.playing}
    style="--stagger: {app.arrival?.stagger ?? 0}ms"
    aria-hidden="true"
    bind:this={backdrop}
  >{@html backdropHtml}</div>
  <textarea
    class="document-editor"
    aria-label="The page"
    placeholder={PAGE.placeholder}
    spellcheck="true"
    bind:this={textarea}
    bind:value={app.editorText}
    {oninput}
    {onscroll}
    {onpointerdown}
    {onclick}
  ></textarea>
</div>

<style>
  /* The paper owns the pane; the writing sits in a centered column on it. */
  .editor-stack { position: relative; width: 100%; max-width: 46rem; flex: 1; margin-inline: auto; }
  .document-editor { display: block; width: 100%; min-height: 34rem; height: 100%; margin: var(--space-0); border: var(--space-0); border-radius: var(--space-0); background-color: transparent; position: relative; padding: var(--space-7) var(--space-8) var(--space-6); font: 1.125rem/var(--line) var(--font-serif); resize: none; scrollbar-width: none; }
  .document-editor:focus-visible { outline: var(--border-accent) solid var(--color-action); outline-offset: calc(var(--border-accent) * -1); }
  .document-editor::placeholder { color: var(--color-text-subtle); font-style: italic; }
  .editor-backdrop { position: absolute; inset: var(--space-0); overflow: hidden; padding: var(--space-7) var(--space-8) var(--space-6); background: transparent; color: transparent; font: 1.125rem/var(--line) var(--font-serif); white-space: pre-wrap; overflow-wrap: break-word; }
  /* A note is a dotted underline until someone reaches for it. */
  .editor-backdrop :global(mark) { border-bottom: var(--border-accent) dotted var(--color-action-border); color: transparent; background: transparent; }
  .editor-backdrop :global(mark.hot) { border-bottom-style: solid; border-radius: var(--radius-xs) var(--radius-xs) var(--space-0) var(--space-0); background: var(--color-highlight); }
  .editor-backdrop :global(mark.breathe) { animation: mark-breathe 300ms var(--ease-ink); }
  .editor-backdrop.arriving :global(mark) { animation: ink-arrive var(--ink-arrive) var(--ease-ink) both; animation-delay: calc(var(--i) * var(--stagger)); }
  @keyframes ink-arrive { from { opacity: 0; } to { opacity: 1; } }
  @keyframes mark-breathe { 50% { background: var(--color-highlight-strong); } }

  @media (max-width: 56rem) {
    .document-editor, .editor-backdrop { padding-right: var(--space-6); padding-left: var(--space-6); }
  }
  @media (max-width: 38rem) {
    .document-editor { min-height: 26rem; font-size: 1.0625rem; }
    .document-editor, .editor-backdrop { padding: var(--line) var(--space-4) var(--space-5); }
    .editor-backdrop { font-size: 1.0625rem; }
  }
</style>
