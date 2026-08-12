<script>
  // The coach's column: stage card on top, span cards in the middle, the ask
  // box pinned at the bottom. One scrollable present; history is a view swap.
  import { app } from "../lib/state.svelte.js";
  import AskBox from "./AskBox.svelte";
  import HistoryList from "./HistoryList.svelte";
  import MarginCards from "./MarginCards.svelte";
  import StageCard from "./StageCard.svelte";
  import { STAGE } from "../lib/copy.js";
</script>

<aside class="coach-sidebar">
  {#if app.sidebarView === "history"}
    <HistoryList />
  {:else}
    <div class="sidebar-scroll">
      <StageCard />
      <MarginCards />
      <footer class="sidebar-foot">
        <button class="text-button" type="button" onclick={() => { app.sidebarView = "history"; }}>{STAGE.history}</button>
      </footer>
    </div>
    <AskBox />
  {/if}
</aside>

<style>
  .coach-sidebar { display: flex; min-height: var(--space-0); flex-direction: column; overflow: hidden; border-left: var(--border-thin) solid var(--color-border); background: var(--color-surface-note); }
  .sidebar-scroll { display: flex; min-height: var(--space-0); flex: 1; flex-direction: column; overflow-y: auto; }
  .sidebar-foot { margin-top: auto; padding: var(--space-2) var(--space-5) var(--space-3); }
  .coach-sidebar :global(.history) { flex: 1; min-height: var(--space-0); overflow: hidden; }
</style>
