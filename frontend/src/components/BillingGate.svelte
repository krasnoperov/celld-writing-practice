<script>
  import { app } from "../lib/state.svelte.js";
  import { checkout, deleteAccount, run } from "../lib/actions.js";
  import { ACCOUNT, planAllowance } from "../lib/copy.js";

  const allowance = $derived(app.billing ? planAllowance(app.billing.plan.monthlyAllowance) : "50 coach sessions / month");
  const subscriptionActive = $derived(["active", "trialing"].includes(app.billing?.subscription?.status));

  function removeAccount() {
    if (confirm(ACCOUNT.confirm)) run(deleteAccount);
  }
</script>

<section class="billing-gate">
  <div class="billing-copy">
    <h1>Make room for a real writing practice.</h1>
    <p>Monthly access keeps every desk — your pages, the letters, and all the reading your coach has done — waiting for you.</p>
    <ul><li>50 coach sessions each month</li><li>A separate desk for every piece</li><li>Cited research and one-problem letters</li><li>Cancel or update payment details through Polar</li></ul>
    <p class="gate-links"><a href="/pricing">What counts as a session →</a></p>
  </div>
  <aside class="plan-card">
    <div class="sample-tab">monthly access</div>
    <h2>Writing Practice</h2>
    <p>A session counts when you start a piece or explicitly ask your coach to work. Writing, editing, and saving never start one.</p>
    <div class="plan-rule"></div>
    <strong>{allowance}</strong>
    <button class="primary-button" type="button" disabled={!app.billing?.configured} onclick={() => run(checkout)}>Continue to secure checkout <span>→</span></button>
    <p class="billing-message" aria-live="polite">{app.billingMessage}</p>
    {#if !subscriptionActive}
      <button class="text-button delete-account" type="button" onclick={removeAccount}>{ACCOUNT.deleteAccount}</button>
    {/if}
  </aside>
</section>

<style>
  .billing-gate { display: grid; grid-template-columns: minmax(0, 0.95fr) minmax(24rem, 1.05fr); align-items: center; gap: var(--space-10); max-width: var(--size-content); min-height: calc(100vh - 12rem); margin: var(--space-0) auto; }
  .billing-copy h1 { max-width: 42rem; margin: var(--space-0) var(--space-0) var(--space-5); font-size: clamp(3.25rem, 6vw, 5.5rem); line-height: 0.93; letter-spacing: -0.055em; }
  .billing-copy p { max-width: 38rem; margin: var(--space-0); color: var(--color-text-muted); font: 1.25rem/1.6 var(--font-serif); }
  .billing-copy ul { margin: var(--space-6) var(--space-0) var(--space-0); padding-left: var(--space-5); color: var(--color-text-muted); font-size: 1rem; line-height: 1.8; }
  .gate-links { margin-top: var(--space-5); }
  .gate-links a { color: var(--color-action); font-size: 1rem; font-weight: 700; text-underline-offset: 0.2rem; }
  .plan-card { position: relative; padding: var(--space-8) var(--space-7); border: var(--border-thin) solid var(--color-border); background: var(--color-surface); box-shadow: var(--shadow-panel); }
  .sample-tab { position: absolute; top: calc(var(--space-4) * -1); left: var(--space-6); padding: var(--space-2) var(--space-4); border: var(--border-thin) solid var(--color-border); background: var(--color-action-soft); color: var(--color-action); font-size: 1rem; font-weight: 650; }
  .plan-card h2 { margin: var(--space-4) var(--space-0) var(--space-5); font-size: 2.5rem; }
  .plan-card > p { color: var(--color-text-muted); font: 1.125rem/1.7 var(--font-serif); }
  .plan-card > strong { display: block; color: var(--color-action); font: 600 1.25rem/1.4 var(--font-serif); }
  .plan-card .primary-button { width: 100%; margin-top: var(--space-5); }
  .plan-rule { height: var(--border-thin); margin: var(--space-6) var(--space-0); background: var(--color-border); }
  .billing-message { min-height: var(--space-5); margin: var(--space-3) var(--space-0) var(--space-0); font: 1rem/1.5 var(--font-sans); color: var(--color-text-muted); }
  .delete-account { margin-top: var(--space-3); color: var(--color-text-subtle); }
  .delete-account:hover { color: var(--color-danger); }

  @media (max-width: 56rem) {
    .billing-gate { grid-template-columns: 1fr; gap: var(--space-8); }
  }
  @media (max-width: 38rem) {
    .plan-card { padding: var(--space-7) var(--space-5); }
  }
</style>
