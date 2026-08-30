<script>
  import { app } from "./lib/state.svelte.js";
  import { boot, run } from "./lib/actions.js";
  import Header from "./components/Header.svelte";
  import Landing from "./components/Landing.svelte";
  import BillingGate from "./components/BillingGate.svelte";
  import Shelf from "./components/Shelf.svelte";
  import Desk from "./components/Desk.svelte";

  $effect.pre(() => {
    run(boot);
  });
</script>

<div class="page-shell" class:desk-shell={app.gate === "in" && app.view === "desk"}>
  {#if app.view !== "desk" || app.gate !== "in"}
    <Header />
  {/if}
  <main class:desk-main={app.gate === "in" && app.view === "desk"}>
    {#if app.gate === "signed-out"}
      <Landing />
    {:else if app.gate === "billing-gate"}
      <BillingGate />
    {:else if app.gate === "in"}
      {#if app.view === "desk" && app.piece}
        <Desk />
      {:else}
        <Shelf />
      {/if}
    {/if}
  </main>
</div>

<style>
  /* The desk runs full-bleed: the shell's page cap and main's side padding
     step aside, leaving a slim gutter so the panel's edge still breathes. */
  .desk-shell { width: 100%; }
  .desk-main { padding: var(--space-4) var(--space-4) var(--space-8); }
</style>
