<script>
  import { app } from "../lib/state.svelte.js";
  import { logout, openPortal, run } from "../lib/actions.js";
  import { sessionsLeft } from "../lib/copy.js";

  const summary = $derived.by(() => {
    if (!app.billing) return "";
    if (app.billing.admin) return "Admin access";
    const active = ["active", "trialing"].includes(app.billing.subscription.status);
    return active ? sessionsLeft(app.billing.usage.remaining) : "Plan required";
  });
</script>

<header class="site-header">
  <a class="brand" href="./" aria-label="Writing Practice home"><span class="brand-mark">W</span><strong>Writing Practice</strong></a>
  {#if app.user}
    <div class="account">
      <img src={app.user.avatarUrl} alt="{app.user.login}'s GitHub avatar" width="32" height="32">
      <strong class="login">{app.user.login}</strong>
      {#if summary}<span class="billing-summary">{summary}</span>{/if}
      {#if app.billing?.subscription?.customerId}
        <button class="text-button" type="button" onclick={() => run(openPortal)}>Manage plan</button>
      {/if}
      {#if app.billing?.admin}
        <a class="text-button admin-link" href="/admin">Billing audit</a>
      {/if}
      <button class="text-button" type="button" onclick={() => run(logout)}>Sign out</button>
    </div>
  {/if}
</header>

<style>
  .account { display: flex; align-items: center; gap: var(--space-3); font-size: 1rem; }
  .account img { border-radius: var(--radius-round); background: var(--color-surface-subtle); }
  .billing-summary { padding: var(--space-1) var(--space-3); border: var(--border-thin) solid var(--color-action-border); border-radius: var(--radius-pill); color: var(--color-action); background: var(--color-action-soft); font-size: 1rem; font-weight: 650; }
  .admin-link { display: inline-block; }

  @media (max-width: 38rem) {
    .account .login, .billing-summary { display: none; }
  }
</style>
