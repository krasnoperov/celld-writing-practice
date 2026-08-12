<script>
  // The stage card: the document-level conversation. Exactly one — what the
  // coach is doing right now, or the last word it sent, plus the one verb
  // this stage of the text makes sensible.
  import { anchorCard } from "../../../src/review-core.js";
  import { renderMarkdown } from "../lib/markdown.js";
  import { app, coachBusy, firstReadDraft, latestDocNote, longEnough as longEnoughGate, verdictReady as verdictReadyGate } from "../lib/state.svelte.js";
  import { deletePiece, markSeen, performAction, run, saveBrief, setAside, writeBack } from "../lib/actions.js";
  import { CONFIRM_DELETE, OPENINGS, SHELF, SHOW_ON_PAGE, STAGE, VERBS, YOU_ASKED, envelopeTitle } from "../lib/copy.js";

  let article = $state(null);
  let briefOpen = $state(false);
  let subject = $state("");
  let aim = $state("");
  let replyOpen = $state(false);
  let replyText = $state("");

  const busy = $derived(coachBusy());
  // Margin passes and answers report where their results land; only the
  // document-level work belongs to the stage card.
  const runningKind = $derived(["reading", "letter", "verdict"].includes(app.piece?.activeJob?.kind) ? app.piece.activeJob.kind : null);
  const note = $derived(latestDocNote());
  const isReading = $derived(note?.kind === "reading");
  const isLetter = $derived(note?.kind === "letter");
  const isVerdict = $derived(note?.kind === "verdict");
  const unanswered = $derived(isLetter && app.piece?.lastLetterNoteId === note?.id);
  const longEnough = $derived(longEnoughGate());
  const verdictReady = $derived(verdictReadyGate());
  const canRead = $derived(isReading && app.piece && app.piece.readingRounds < app.piece.maxReadingRounds);
  const replies = $derived(app.notes.filter((candidate) => candidate.kind === "reply" && candidate.answersNoteId === note?.id));
  const openings = $derived(isReading ? (note.openings ?? []) : []);

  const html = $derived.by(() => {
    if (runningKind || !note) return "";
    if (isReading) return renderMarkdown(note.note || note.body);
    return renderMarkdown(note.body);
  });
  // The verdict leads with its judgment; the first sentence is set large.
  const verdictLead = $derived.by(() => {
    if (!isVerdict) return null;
    const match = note.body.match(/^(.{0,120}?[.!?])\s+([\s\S]*)$/);
    return match ? { lead: match[1], rest: match[2] } : { lead: "", rest: note.body };
  });
  // The reading took real work; it sits on the desk in full, never behind a
  // fold — the lead note above, the depth scrolling in its own region below.
  const fullHtml = $derived(isReading && note.note ? renderMarkdown(note.body) : "");

  $effect(() => {
    if (note?.id === undefined && note) return;
    replyOpen = false;
    replyText = "";
  });
  // Rendered on the desk is read: no envelopes to open, nothing left "unread".
  $effect(() => {
    if (note && !note.seenAt && !runningKind) run(() => markSeen(note.id));
  });

  function point(quote) {
    app.pointRequest = { quote, seq: Date.now() };
    if (app.isMobile) app.mobileView = "page";
  }

  // Quoted spans in letters and verdicts that still occur verbatim on the
  // page are the coach's finger — click to be shown on the page.
  $effect(() => {
    if (!html || !article || (!isLetter && !isVerdict)) return;
    for (const blockquote of article.querySelectorAll("blockquote")) {
      const quote = blockquote.textContent.trim();
      if (!quote || !anchorCard({ quote }, app.editorText)) continue;
      const pointer = document.createElement("button");
      pointer.type = "button";
      pointer.className = "quote-pointer";
      pointer.textContent = SHOW_ON_PAGE;
      pointer.addEventListener("click", () => point(quote));
      blockquote.append(pointer);
    }
    for (const paragraph of article.querySelectorAll("p")) {
      if (paragraph.children.length || paragraph.closest("blockquote")) continue;
      const text = paragraph.textContent;
      const matches = [...text.matchAll(/[“"]([^”"]{12,200})[”"]/g)]
        .filter((match) => anchorCard({ quote: match[1] }, app.editorText));
      if (!matches.length) continue;
      paragraph.textContent = "";
      let cursor = 0;
      for (const match of matches) {
        paragraph.append(text.slice(cursor, match.index));
        const live = document.createElement("span");
        live.className = "quote-live";
        live.role = "button";
        live.tabIndex = 0;
        live.title = SHOW_ON_PAGE;
        live.textContent = text.slice(match.index, match.index + match[0].length);
        live.addEventListener("click", () => point(match[1]));
        live.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            point(match[1]);
          }
        });
        paragraph.append(live);
        cursor = match.index + match[0].length;
      }
      paragraph.append(text.slice(cursor));
    }
  });

  function openBrief() {
    subject = app.piece.brief.subject;
    aim = app.piece.brief.aim;
    briefOpen = true;
  }

  function submitBrief(event) {
    event.preventDefault();
    run(async () => {
      await saveBrief({ subject, aim });
      briefOpen = false;
    });
  }

  function confirmDelete() {
    if (!confirm(CONFIRM_DELETE)) return;
    run(deletePiece);
  }

  function sendReply() {
    const body = replyText.trim();
    if (!body) return;
    run(async () => {
      await writeBack(note.id, body);
      replyText = "";
      replyOpen = false;
    });
  }
</script>

<section class="stage-card" aria-label="Your coach">
  <header class="brief-row">
    {#if briefOpen}
      <form class="brief-form" onsubmit={submitBrief}>
        <label>{SHELF.question}<textarea rows="2" required minlength="3" bind:value={subject}></textarea></label>
        <label>{SHELF.aimLabel}<input bind:value={aim}></label>
        <div class="brief-actions">
          <button class="secondary-button" type="submit">{STAGE.saveBrief}</button>
          <button class="text-button" type="button" onclick={() => { briefOpen = false; }}>Cancel</button>
          <button class="text-button delete" type="button" onclick={confirmDelete}>{VERBS.deletePiece}</button>
        </div>
      </form>
    {:else}
      <button class="brief-line" type="button" onclick={openBrief} title={STAGE.editBrief}>
        <strong>{app.piece.brief.subject}</strong>
        {#if app.piece.brief.aim}<span>▸ {app.piece.brief.aim}</span>{/if}
      </button>
    {/if}
  </header>

  {#if runningKind}
    <p class="running-line"><i class="presence-dot running" aria-hidden="true"></i>{STAGE.running[runningKind]}</p>
    {#if runningKind === "reading" && !note}
      <div class="openings">
        <small>{OPENINGS.waitingTitle}</small>
        {#each OPENINGS.generic as question (question)}
          <button class="opening-chip" type="button" onclick={() => { app.ask = question; }}>{question}</button>
        {/each}
      </div>
    {/if}
  {:else if note}
    {#key note.id}
      <div class="stage-body">
        <h2 class="note-title">{envelopeTitle(note)}</h2>
        {#if note.ask}
          <p class="you-asked"><small>{YOU_ASKED}</small> {note.ask}</p>
        {/if}
        {#if isVerdict}
          <p class="verdict-lead">{verdictLead.lead}</p>
          <article class="markdown-document note-body long" bind:this={article}>{@html renderMarkdown(verdictLead.rest)}</article>
        {:else}
          <article class="markdown-document note-body" class:long={isLetter} bind:this={article}>{@html html}</article>
        {/if}

        {#if isReading}
          {#if fullHtml}
            <article class="markdown-document note-body full-reading">{@html fullHtml}</article>
          {/if}
          {#if openings.length}
            <div class="openings">
              <small>{OPENINGS.readingTitle}</small>
              {#each openings as question (question)}
                <button class="opening-chip" class:active={app.ask === question} type="button" onclick={() => { app.ask = app.ask === question ? "" : question; }}>{question}</button>
              {/each}
            </div>
          {/if}
        {/if}

        {#each replies as reply (reply.id)}
          <div class="reply">
            <small>{envelopeTitle(reply)}</small>
            <p>{reply.body}</p>
          </div>
        {/each}
        {#if (isLetter || isVerdict) && !replies.length}
          {#if replyOpen}
            <div class="write-back">
              <label>{VERBS.writeBackHint}<textarea rows="3" bind:value={replyText}></textarea></label>
              <button class="secondary-button" type="button" onclick={sendReply}>{VERBS.writeBackSend}</button>
            </div>
          {:else}
            <button class="text-button" type="button" onclick={() => { replyOpen = true; }}>{VERBS.writeBack}</button>
          {/if}
        {/if}
      </div>
    {/key}
  {/if}

  {#if !busy && app.piece?.failedJob}
    <p class="gate-line">{STAGE.failed}</p>
  {/if}

  {#if !runningKind}
    <div class="stage-verb">
      {#if app.piece?.awaitingVerdict}
        <button class="primary-button" type="button" disabled={busy || !verdictReady} onclick={() => run(() => performAction("verdict"))}>{VERBS.verdict}</button>
        <p class="gate-line">{verdictReady ? VERBS.verdictHint : VERBS.verdictGate}</p>
        {#if unanswered}
          <button class="text-button" type="button" onclick={() => run(() => setAside(note.id))}>{VERBS.asideLetter}</button>
        {/if}
      {:else if longEnough}
        <button class="primary-button" type="button" disabled={busy} onclick={() => run(() => performAction("letter"))}>{firstReadDraft() ? VERBS.firstRead : VERBS.letter}</button>
        <p class="gate-line">{firstReadDraft() ? VERBS.firstReadHint : VERBS.letterHint}</p>
      {:else if !runningKind && note}
        <p class="gate-line">{STAGE.keepGoing}</p>
      {/if}
      {#if canRead && !busy}
        <button class="text-button" type="button" onclick={() => run(() => performAction("read"))}>{VERBS.anotherReading}</button>
      {/if}
    </div>
  {/if}
</section>

<style>
  .stage-card { padding: var(--space-4) var(--space-5); border-bottom: var(--border-thin) solid var(--color-rule); }
  .brief-row { margin-bottom: var(--space-3); }
  .brief-line { display: block; width: 100%; margin: var(--space-0); padding: var(--space-0); border: var(--space-0); background: transparent; cursor: pointer; text-align: left; }
  .brief-line strong { display: block; font: 600 1.125rem/1.3 var(--font-serif); color: var(--color-text); }
  .brief-line span { color: var(--color-text-muted); font: italic 1rem/1.4 var(--font-serif); }
  .brief-line:hover strong { color: var(--color-action); }
  .brief-form label { margin-bottom: var(--space-3); font-size: 1rem; }
  .brief-actions { display: flex; align-items: center; gap: var(--space-3); }
  .brief-actions .delete { margin-left: auto; }
  .running-line { display: flex; align-items: center; gap: var(--space-2); margin: var(--space-0) var(--space-0) var(--space-3); color: var(--color-text-muted); font: italic 1rem/1.5 var(--font-serif); }
  .stage-body { animation: settle var(--ink-settle) var(--ease-ink); }
  @keyframes settle { from { opacity: 0; transform: translateY(var(--space-2)); } to { opacity: 1; transform: translateY(0); } }
  .note-title { margin: var(--space-0) var(--space-0) var(--space-2); color: var(--color-action); font: 650 1rem/1.4 var(--font-sans); }
  .you-asked { margin: var(--space-0) var(--space-0) var(--space-2); color: var(--color-text-soft); font: italic 1rem/1.5 var(--font-serif); }
  .you-asked small { margin-right: var(--space-1); color: var(--color-text-subtle); font: 650 1rem/1.4 var(--font-sans); font-style: normal; }
  .note-body { min-height: auto; padding: var(--space-0) var(--space-0) var(--space-3); font-size: 1rem; }
  /* Long letters and the full reading read inside their own region; the index
     below stays in reach. The fade names the fold — more waits below. */
  .note-body.long, .full-reading { max-height: 19rem; overflow-y: auto; scrollbar-width: thin; mask-image: linear-gradient(to bottom, black calc(100% - var(--space-4)), transparent); }
  .note-body :global(h2) { font-size: 1.125rem; }
  .note-body :global(h3) { font-size: 1rem; }
  .note-body :global(.quote-live) { background: linear-gradient(transparent 62%, var(--color-highlight) 62%); cursor: pointer; }
  .note-body :global(.quote-live:hover), .note-body :global(.quote-live:focus-visible) { background: linear-gradient(transparent 62%, var(--color-action-soft) 62%); color: var(--color-action); }
  .verdict-lead { margin: var(--space-0) var(--space-0) var(--space-3); font: 500 1.25rem/1.35 var(--font-serif); color: var(--color-text); }
  .full-reading { margin-bottom: var(--space-3); padding-top: var(--space-3); border-top: var(--border-thin) solid var(--color-rule); }
  .openings { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-1); margin-bottom: var(--space-3); }
  .openings small { color: var(--color-text-subtle); font: 650 1rem/1.4 var(--font-sans); }
  .opening-chip { padding: var(--space-1) var(--space-2); border: var(--space-0); border-radius: var(--radius-xs); background: transparent; color: var(--color-action); font: italic 1rem/1.45 var(--font-serif); cursor: pointer; text-align: left; }
  .opening-chip:hover, .opening-chip.active { background: var(--color-action-soft); }
  .reply { margin-bottom: var(--space-3); padding: var(--space-2) var(--space-3); border-left: var(--border-accent) solid var(--color-border-strong); background: var(--color-surface); }
  .reply small { color: var(--color-text-subtle); font-size: 1rem; font-weight: 650; }
  .reply p { margin: var(--space-1) var(--space-0) var(--space-0); font: italic 1rem/1.5 var(--font-serif); }
  .write-back { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-2); justify-items: end; margin-bottom: var(--space-3); }
  .write-back label { width: 100%; margin: var(--space-0); font-size: 1rem; }
  .stage-verb { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-2); justify-items: start; margin-top: var(--space-3); }
  .stage-verb .primary-button { justify-self: stretch; justify-content: center; font-size: 1rem; }
  .gate-line { margin: var(--space-0); color: var(--color-text-subtle); font-size: 1rem; line-height: 1.5; }
</style>
