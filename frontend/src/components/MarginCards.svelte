<script>
  // Span cards: the index of the underlines. Compact rows in page order, one
  // expanded at a time. A card leaves when its sentence is rewritten (the
  // writer dealt with it) or dismissed — the stack converges to clean.
  import { slide } from "svelte/transition";
  import { app, coachBusy, latestMargin, longEnough as longEnoughGate, spanCards, wholePieceCards } from "../lib/state.svelte.js";
  import { dismissCard, markSeen, performAction, run } from "../lib/actions.js";
  import { CARDS, MARGIN } from "../lib/copy.js";

  let wholeOpen = $state(false);
  let list = $state(null);

  const margin = $derived(latestMargin());
  const spans = $derived(spanCards());
  const whole = $derived(wholePieceCards());
  const passRunning = $derived(app.piece?.activeJob?.kind === "margin");
  const busy = $derived(coachBusy());
  const longEnough = $derived(longEnoughGate());

  // Cards on the desk count as read the moment they render.
  $effect(() => {
    if (margin && !margin.seenAt) run(() => markSeen(margin.id));
  });

  function toggleCard(index, quote) {
    const opening = app.activeCard !== index;
    app.activeCard = opening ? index : null;
    if (opening) app.pointRequest = { quote, index, seq: Date.now() };
  }

  // Whether opened from the sidebar or from its underline on the page, the
  // expanded card comes into view.
  $effect(() => {
    const index = app.activeCard;
    if (index === null || !list) return;
    requestAnimationFrame(() => {
      const reduceMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
      list?.querySelector(`[data-card-index="${index}"]`)?.scrollIntoView({
        block: "nearest",
        behavior: reduceMotion ? "auto" : "smooth",
      });
    });
  });
</script>

<section class="margin-cards" aria-label="Margin notes" bind:this={list}>
  {#if passRunning}
    <p class="pass-line" transition:slide><i class="presence-dot running" aria-hidden="true"></i>{CARDS.reading}</p>
  {/if}

  {#if margin && (whole.length || margin.overview)}
    <div class="whole-row" transition:slide>
      <button class="row-head" type="button" onclick={() => { wholeOpen = !wholeOpen; }} aria-expanded={wholeOpen}>
        <span class="category">{MARGIN.overviewTitle}</span>
        <span class="disclosure">{wholeOpen ? "▾" : "▸"}</span>
      </button>
      {#if wholeOpen}
        <div class="row-body" transition:slide>
          {#if margin.overview}<p>{margin.overview}</p>{/if}
          {#each whole as { card, index } (index)}
            <div class="whole-card">
              <header>
                <span class="category">{MARGIN.categories[card.category] || card.category}</span>
                <button class="text-button" type="button" aria-label={MARGIN.dismiss} onclick={() => run(() => dismissCard(margin.id, index))}>×</button>
              </header>
              <p>{card.note}</p>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  {#each spans as { card, index } (index)}
    <article
      class="span-card"
      class:open={app.activeCard === index}
      data-card-index={index}
      transition:slide
      onmouseenter={() => { app.hotCard = index; }}
      onmouseleave={() => { app.hotCard = null; }}
    >
      <button class="row-head" type="button" onclick={() => toggleCard(index, card.quote)} aria-expanded={app.activeCard === index}>
        <span class="category">{MARGIN.categories[card.category] || card.category}</span>
        <span class="quote">{card.quote}</span>
      </button>
      {#if app.activeCard === index}
        <div class="row-body" transition:slide>
          <p>{card.note}</p>
          {#if card.variants?.length}
            <div class="variants">
              <small>{MARGIN.variantsLabel}</small>
              {#each card.variants as variant (variant)}
                <p class="variant">{variant}</p>
              {/each}
            </div>
          {/if}
          <button class="text-button" type="button" onclick={() => run(() => dismissCard(margin.id, index))}>{MARGIN.dismiss}</button>
        </div>
      {/if}
    </article>
  {/each}

  {#if longEnough && !passRunning}
    <div class="margin-request">
      {#if !spans.length && !whole.length}<p class="hint-line">{CARDS.hint}</p>{/if}
      <button class="secondary-button" type="button" disabled={busy} onclick={() => run(() => performAction("margin"))}>{MARGIN.request}</button>
    </div>
  {/if}
</section>

<style>
  /* minmax(0, 1fr) pins every track to the column: a card's content can never
     widen the stack past the sidebar. */
  .margin-cards { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-2); align-content: start; padding: var(--space-4) var(--space-5); }
  .pass-line { display: flex; align-items: center; gap: var(--space-2); margin: var(--space-0); color: var(--color-text-muted); font: italic 1rem/1.5 var(--font-serif); }
  .hint-line { margin: var(--space-0); color: var(--color-text-subtle); font-size: 1rem; line-height: 1.55; }
  .margin-request { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-3); justify-items: start; padding-top: var(--space-2); }
  .whole-row, .span-card { border: var(--border-thin) solid var(--color-border); border-radius: var(--radius-xs); background: var(--color-surface-raised); }
  .span-card.open, .whole-row:hover, .span-card:hover { border-color: var(--color-border-strong); }
  .span-card.open { box-shadow: var(--shadow-soft); }
  .row-head { display: flex; width: 100%; align-items: baseline; gap: var(--space-3); margin: var(--space-0); padding: var(--space-2) var(--space-3); border: var(--space-0); background: transparent; cursor: pointer; text-align: left; }
  .category { flex: 0 0 auto; color: var(--color-action); font: 650 1rem/1.5 var(--font-sans); }
  .quote { flex: 1; min-width: var(--space-0); overflow: hidden; color: var(--color-text-soft); font: italic 1rem/1.5 var(--font-serif); text-overflow: ellipsis; white-space: nowrap; }
  .disclosure { margin-left: auto; color: var(--color-text-subtle); font-size: 1rem; }
  .row-body { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-2); justify-items: start; padding: var(--space-0) var(--space-3) var(--space-3); }
  .row-body p { margin: var(--space-0); color: var(--color-text-soft); font-size: 1rem; line-height: 1.55; }
  .whole-card { width: 100%; padding-top: var(--space-2); border-top: var(--border-thin) solid var(--color-rule); }
  .whole-card header { display: flex; align-items: center; justify-content: space-between; }
  .whole-card p { margin: var(--space-1) var(--space-0) var(--space-0); color: var(--color-text-soft); font-size: 1rem; line-height: 1.55; }
  .variants small { display: block; margin-bottom: var(--space-1); color: var(--color-text-subtle); font: 650 1rem/1.4 var(--font-sans); }
  .variant { padding-left: var(--space-2); border-left: var(--border-accent) solid var(--color-action-border); font-style: italic; }
</style>
