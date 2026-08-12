<script>
  import { app, isDirty } from "../lib/state.svelte.js";
  import { run, saveDraft, showShelf } from "../lib/actions.js";
  import { PAGE, SHELF, TABS } from "../lib/copy.js";
  import CoachSidebar from "./CoachSidebar.svelte";
  import Editor from "./Editor.svelte";

  const words = $derived(app.editorText.split(/\s+/).filter(Boolean).length);
  const saveLine = $derived(
    app.saveState === "saving" ? PAGE.saving
    : app.saveState === "dirty" ? "" // quiet while typing; autosave will whisper
    : PAGE.saved,
  );
  const unseen = $derived(app.notes.filter((note) => !note.seenAt && note.kind !== "reply").length);
  const coachView = $derived(app.isMobile && app.mobileView === "coach");

  function back() {
    run(showShelf);
  }

  function keepLocal() {
    run(async () => {
      const local = app.conflict.local;
      app.doc = app.conflict.server;
      app.editorText = local;
      app.conflict = null;
      await saveDraft();
    });
  }

  function loadServer() {
    app.doc = app.conflict.server;
    app.editorText = app.conflict.server.markdown;
    app.conflict = null;
    app.saveState = "saved";
  }

  function onEscape(event) {
    if (event.key !== "Escape") return;
    if (app.activeCard !== null) app.activeCard = null;
    else if (app.sidebarView === "history") app.sidebarView = "coach";
  }
</script>

<svelte:window onkeydown={onEscape} />

<section class="desk">
  <header class="desk-bar">
    <button class="text-button back" type="button" onclick={back}>← {SHELF.back}</button>
  </header>

  <div class="desk-body">
    {#if !coachView}
      <div class="page-column">
        <Editor />
        {#if app.conflict}
          <div class="conflict-bar">
            <p>{PAGE.conflict}</p>
            <div>
              <button class="secondary-button" type="button" onclick={loadServer}>Load the other version</button>
              <button class="primary-button" type="button" onclick={keepLocal}>Keep my version</button>
            </div>
          </div>
        {/if}
        <footer class="page-foot">
          <span aria-live="polite">{saveLine}</span>
          <span>{PAGE.words(words)}</span>
        </footer>
      </div>
    {/if}
    {#if !app.isMobile || coachView}
      <CoachSidebar />
    {/if}
  </div>

  <nav class="mobile-tabs" aria-label="Desk views">
    <button class="tab" class:current={!coachView} type="button" onclick={() => { app.mobileView = "page"; }}>{TABS.page}</button>
    <button class="tab" class:current={coachView} type="button" onclick={() => { app.mobileView = "coach"; }}>
      {TABS.coach}
      {#if unseen && !coachView}<i class="presence-dot" aria-hidden="true"></i>{/if}
    </button>
  </nav>

  <p class="app-status desk-status" aria-live="polite">{app.status}</p>
</section>

<style>
  .desk { max-width: var(--size-content); margin: var(--space-0) auto; }
  .desk-bar { display: flex; align-items: center; gap: var(--space-5); margin-bottom: var(--space-3); }
  /* The desk is a fixed surface: the page scrolls inside its own paper, the
     coach's column scrolls on its own. */
  .desk-body { display: grid; grid-template-columns: minmax(0, 1fr) 28rem; height: calc(100vh - 8rem); border: var(--border-thin) solid var(--color-border); background: var(--color-surface-raised); box-shadow: var(--shadow-panel); }
  .page-column { display: flex; min-width: var(--space-0); flex-direction: column; background: var(--color-surface-raised); }
  .page-foot { display: flex; justify-content: space-between; gap: var(--space-5); margin-top: auto; padding: var(--space-2) var(--space-5); border-top: var(--border-thin) solid var(--color-rule); color: var(--color-text-subtle); font-size: 1rem; }
  .conflict-bar { display: flex; align-items: center; justify-content: space-between; gap: var(--space-5); padding: var(--space-4) var(--space-5); border-top: var(--border-accent) solid var(--color-action); background: var(--color-action-soft); }
  .conflict-bar p { margin: var(--space-0); color: var(--color-text-soft); font-size: 1rem; }
  .conflict-bar > div { display: flex; flex: 0 0 auto; gap: var(--space-2); }
  .desk-status { margin-top: var(--space-3); }
  .mobile-tabs { display: none; }

  @media (max-width: 56rem) {
    .desk { padding-bottom: var(--space-7); }
    .desk-body { grid-template-columns: 1fr; height: calc(100vh - 10.5rem); }
    .desk-body :global(.coach-sidebar) { border-left: var(--space-0); }
    .conflict-bar { align-items: start; flex-direction: column; }
    .mobile-tabs { position: fixed; right: var(--space-0); bottom: var(--space-0); left: var(--space-0); z-index: 30; display: flex; border-top: var(--border-thin) solid var(--color-border); background: var(--color-surface-note); }
    .tab { display: flex; flex: 1; align-items: center; justify-content: center; gap: var(--space-2); padding: var(--space-3) var(--space-4); border: var(--space-0); background: transparent; color: var(--color-text-muted); font-size: 1rem; cursor: pointer; }
    .tab.current { color: var(--color-action); font-weight: 750; box-shadow: inset 0 var(--border-accent) var(--color-action); }
  }
</style>
