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

<div class="page-shell">
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
  .desk-main { padding-top: var(--space-4); }
</style>
