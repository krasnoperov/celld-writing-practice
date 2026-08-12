<script>
  // The ask box: a direct question, a direct answer — rendered right above
  // the box that asked it. Earlier answers live in the correspondence.
  import { renderMarkdown } from "../lib/markdown.js";
  import { app, coachBusy, latestAnswer } from "../lib/state.svelte.js";
  import { markSeen, run, sendAsk } from "../lib/actions.js";
  import { ASKBOX, YOU_ASKED } from "../lib/copy.js";

  let closedAnswerId = $state(null);

  const busy = $derived(coachBusy());
  const answering = $derived(app.piece?.activeJob?.kind === "answer");
  const answer = $derived(latestAnswer());
  const showAnswer = $derived(Boolean(answer) && !answering && answer.id !== closedAnswerId);

  $effect(() => {
    if (showAnswer && !answer.seenAt) run(() => markSeen(answer.id));
  });

  function submit(event) {
    event.preventDefault();
    run(sendAsk);
  }
</script>

<div class="ask-zone">
  {#if answering}
    <div class="answer-card">
      <p class="asked"><small>{YOU_ASKED}</small> {app.pendingAsk}</p>
      <p class="thinking"><i class="presence-dot running" aria-hidden="true"></i>{ASKBOX.thinking}</p>
    </div>
  {:else if showAnswer}
    <div class="answer-card settled">
      <header>
        <p class="asked"><small>{YOU_ASKED}</small> {answer.ask}</p>
        <button class="text-button" type="button" aria-label="Close" onclick={() => { closedAnswerId = answer.id; }}>✕</button>
      </header>
      <article class="markdown-document answer-body">{@html renderMarkdown(answer.body)}</article>
    </div>
  {/if}
  <form class="ask-form" onsubmit={submit}>
    <input bind:value={app.ask} placeholder={ASKBOX.placeholder} aria-label={ASKBOX.label} autocomplete="off" />
    <button class="secondary-button" type="submit" disabled={busy || !app.ask.trim()}>{ASKBOX.send}</button>
  </form>
  <small class="session-note">{ASKBOX.session}</small>
</div>

<style>
  .ask-zone { padding: var(--space-3) var(--space-5) var(--space-4); border-top: var(--border-thin) solid var(--color-rule); }
  .answer-card { margin-bottom: var(--space-3); }
  .answer-card.settled { animation: settle var(--ink-settle) var(--ease-ink); }
  @keyframes settle { from { opacity: 0; transform: translateY(var(--space-2)); } to { opacity: 1; transform: translateY(0); } }
  .answer-card header { display: flex; align-items: start; justify-content: space-between; gap: var(--space-3); }
  .asked { margin: var(--space-0); color: var(--color-text-soft); font: italic 1rem/1.5 var(--font-serif); }
  .asked small { margin-right: var(--space-1); color: var(--color-text-subtle); font: 650 1rem/1.4 var(--font-sans); font-style: normal; }
  .thinking { display: flex; align-items: center; gap: var(--space-2); margin: var(--space-2) var(--space-0) var(--space-0); color: var(--color-text-muted); font: italic 1rem/1.5 var(--font-serif); }
  .answer-body { min-height: auto; max-height: 16rem; overflow-y: auto; margin-top: var(--space-2); padding: var(--space-0); font-size: 1rem; line-height: 1.6; }
  .ask-form { display: flex; gap: var(--space-2); }
  .ask-form input { margin: var(--space-0); padding: var(--space-2) var(--space-3); font: italic 1rem/1.5 var(--font-serif); }
  .ask-form input::placeholder { color: var(--color-text-subtle); }
  .ask-form .secondary-button { flex: 0 0 auto; font-size: 1rem; }
  .session-note { display: block; margin-top: var(--space-2); color: var(--color-text-subtle); font-size: 1rem; line-height: 1.4; }
</style>
