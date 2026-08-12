<script>
  // The correspondence: everything the desk has ever exchanged, newest first,
  // each entry unfolding in place. A view of the sidebar, never an overlay.
  import { slide } from "svelte/transition";
  import { renderMarkdown } from "../lib/markdown.js";
  import { app } from "../lib/state.svelte.js";
  import { markSeen, run } from "../lib/actions.js";
  import { HISTORY, MARGIN, YOU_ASKED, envelopeTitle } from "../lib/copy.js";

  let openId = $state(null);

  const entries = $derived([...app.notes].reverse());

  function when(note) {
    const date = new Date(note.createdAt);
    return Number.isFinite(date.getTime()) ? date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "";
  }

  function toggle(note) {
    openId = openId === note.id ? null : note.id;
    if (openId && !note.seenAt) run(() => markSeen(note.id));
  }

  function bodyHtml(note) {
    if (note.kind === "reading" && note.note) return renderMarkdown(`${note.note}\n\n---\n\n${note.body}`);
    return renderMarkdown(note.body ?? "");
  }
</script>

<div class="history">
  <header>
    <button class="text-button" type="button" onclick={() => { app.sidebarView = "coach"; }}>← {HISTORY.back}</button>
  </header>
  {#if !entries.length}
    <p class="empty">{HISTORY.empty}</p>
  {/if}
  <div class="entries">
    {#each entries as note (note.id)}
      <div class="entry" class:reply={note.kind === "reply"}>
        <button class="entry-head" type="button" onclick={() => toggle(note)} aria-expanded={openId === note.id}>
          <span class="entry-title">{envelopeTitle(note)}</span>
          <time>{when(note)}</time>
          {#if !note.seenAt && note.kind !== "reply"}<i class="presence-dot" aria-hidden="true"></i>{/if}
        </button>
        {#if openId === note.id}
          <div class="entry-body" transition:slide>
            {#if note.ask}
              <p class="asked"><small>{YOU_ASKED}</small> {note.ask}</p>
            {/if}
            {#if note.kind === "margin"}
              {#if note.overview}<p class="overview">{note.overview}</p>{/if}
              {#each note.cards as card (card.note)}
                <div class="margin-entry">
                  <span class="category">{MARGIN.categories[card.category] || card.category}</span>
                  {#if card.quote}<p class="quote">{card.quote}</p>{/if}
                  <p>{card.note}</p>
                </div>
              {/each}
            {:else}
              <article class="markdown-document entry-markdown">{@html bodyHtml(note)}</article>
            {/if}
          </div>
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  .history { display: flex; flex-direction: column; min-height: var(--space-0); padding: var(--space-4) var(--space-5); }
  header { margin-bottom: var(--space-3); }
  .empty { margin: var(--space-0); color: var(--color-text-subtle); font-size: 1rem; }
  .entries { overflow-y: auto; border-top: var(--border-thin) solid var(--color-rule); }
  .entry { border-bottom: var(--border-thin) solid var(--color-rule); }
  .entry-head { display: flex; width: 100%; align-items: baseline; gap: var(--space-3); margin: var(--space-0); padding: var(--space-2) var(--space-1); border: var(--space-0); background: transparent; cursor: pointer; text-align: left; }
  .entry.reply .entry-head { cursor: pointer; }
  .entry-title { font: 600 1rem/1.4 var(--font-serif); color: var(--color-text); }
  .entry-head time { margin-left: auto; color: var(--color-text-subtle); font-size: 1rem; }
  .entry-body { padding: var(--space-0) var(--space-1) var(--space-3); }
  .asked { margin: var(--space-0) var(--space-0) var(--space-2); color: var(--color-text-soft); font: italic 1rem/1.5 var(--font-serif); }
  .asked small { margin-right: var(--space-1); color: var(--color-text-subtle); font: 650 1rem/1.4 var(--font-sans); font-style: normal; }
  .entry-markdown { min-height: auto; padding: var(--space-0); font-size: 1rem; line-height: 1.6; }
  .entry-markdown :global(h2) { font-size: 1.125rem; }
  .entry-markdown :global(h3) { font-size: 1rem; }
  .overview { margin: var(--space-0) var(--space-0) var(--space-2); color: var(--color-text-soft); font-size: 1rem; line-height: 1.55; }
  .margin-entry { margin-bottom: var(--space-2); padding-top: var(--space-2); border-top: var(--border-thin) solid var(--color-rule); }
  .margin-entry .category { color: var(--color-action); font: 650 1rem/1.5 var(--font-sans); }
  .margin-entry .quote { margin: var(--space-1) var(--space-0); padding-left: var(--space-2); border-left: var(--border-accent) solid var(--color-highlight); color: var(--color-text-soft); font: italic 1rem/1.5 var(--font-serif); }
  .margin-entry p { margin: var(--space-1) var(--space-0) var(--space-0); color: var(--color-text-soft); font-size: 1rem; line-height: 1.55; }
</style>
