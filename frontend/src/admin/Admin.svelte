<script>
  import { jsonRequest } from "../lib/api.js";

  let accounts = $state([]);
  let query = $state("");
  let selected = $state(null); // full account payload
  let status = $state("");
  let delta = $state("");
  let reason = $state("");
  let adjustmentId = $state("");
  let resolutionReason = $state("");

  function fail(error) {
    status = error instanceof Error ? error.message : String(error);
  }

  function formatDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—";
  }

  async function loadAccounts() {
    ({ accounts } = await jsonRequest(`api/admin/accounts?query=${encodeURIComponent(query)}`));
  }

  async function select(userId) {
    selected = await jsonRequest(`api/admin/accounts/${encodeURIComponent(userId)}`);
  }

  async function adjust(event) {
    event.preventDefault();
    if (!selected) return;
    try {
      adjustmentId ||= crypto.randomUUID();
      await jsonRequest(`api/admin/accounts/${encodeURIComponent(selected.userId)}/adjust`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": adjustmentId },
        body: JSON.stringify({ delta: Number(delta), reason }),
      });
      delta = "";
      reason = "";
      adjustmentId = "";
      status = "Adjustment recorded in the authoritative account cell.";
      await select(selected.userId);
      await loadAccounts();
    } catch (error) { fail(error); }
  }

  async function resolve(operation, resolution) {
    if (!selected || resolutionReason.trim().length < 5) {
      status = "Add a short reason before resolving a reservation.";
      return;
    }
    try {
      await jsonRequest(`api/admin/accounts/${encodeURIComponent(selected.userId)}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ requestId: operation.id, resolution, reason: resolutionReason }),
      });
      status = resolution === "released" ? "Reservation released and its credit returned." : "Reservation marked completed.";
      resolutionReason = "";
      await select(selected.userId);
      await loadAccounts();
    } catch (error) { fail(error); }
  }

  async function reconcile() {
    if (!selected) return;
    try {
      status = "Reconciling with Polar…";
      await jsonRequest(`api/admin/accounts/${encodeURIComponent(selected.userId)}/reconcile`, { method: "POST" });
      status = "Provider state reconciled and recorded.";
      await select(selected.userId);
      await loadAccounts();
    } catch (error) { fail(error); }
  }

  $effect.pre(() => {
    (async () => {
      const billing = await jsonRequest("api/billing/status").catch(() => null);
      if (!billing?.admin) {
        location.href = "/";
        return;
      }
      await loadAccounts().catch(fail);
    })();
  });

  const pendingOperations = $derived(selected ? selected.operations.filter((value) => value.status === "reserved") : []);
  const pending = $derived(pendingOperations.length);
  const remaining = $derived(selected ? Math.max(0, selected.usage.granted - selected.usage.used) : 0);
</script>

<div class="page-shell">
  <header class="site-header">
    <a class="brand" href="./" aria-label="Writing Practice home"><span class="brand-mark">W</span><strong>Writing Practice</strong></a>
  </header>
  <main>
    <section class="admin-panel">
      <header class="admin-heading">
        <div><h1>Billing audit</h1><p>The account cell is authoritative. This list is a retryable projection for inspection and recovery.</p></div>
        <a class="secondary-button" href="/">Return to the desk</a>
      </header>
      <div class="admin-grid">
        <aside class="admin-list-panel">
          <form class="admin-search" onsubmit={(event) => { event.preventDefault(); loadAccounts().catch(fail); }}>
            <input aria-label="Search billing accounts" placeholder="GitHub login or user ID" bind:value={query}>
            <button class="secondary-button" type="submit">Search</button>
          </form>
          <div class="admin-account-list">
            {#each accounts as account (account.userId)}
              <button class="admin-account" class:active={account.userId === selected?.userId} type="button" onclick={() => select(account.userId).catch(fail)}>
                <strong><span>{account.login}</span><span>{account.subscriptionStatus}</span></strong>
                <span><span>{account.userId}</span><span>{account.remaining} remaining</span></span>
              </button>
            {/each}
          </div>
          {#if !accounts.length}<p class="library-empty">No billing accounts match this search.</p>{/if}
        </aside>
        {#if selected}
          <article class="admin-detail">
            <div class="admin-detail-heading">
              <div><h2>{selected.profile?.login || "Unknown GitHub account"}</h2><p>GitHub user {selected.userId}</p></div>
              <button class="secondary-button" type="button" onclick={reconcile}>Reconcile with Polar</button>
            </div>
            <dl class="balance-grid">
              <div><dt>Subscription</dt><dd>{selected.subscription.status}</dd></div>
              <div><dt>Remaining</dt><dd>{remaining}</dd></div>
              <div><dt>Used</dt><dd>{selected.usage.used} / {selected.usage.granted}</dd></div>
              <div><dt>Pending</dt><dd>{pending}</dd></div>
            </dl>
            <form class="adjustment-form" onsubmit={adjust}>
              <h3>Record an adjustment</h3>
              <div>
                <label>Agent runs<input type="number" step="1" required placeholder="10 or -5" bind:value={delta} oninput={() => { adjustmentId = ""; }}></label>
                <label>Reason<input required minlength="5" maxlength="300" placeholder="Support case or reconciliation note" bind:value={reason} oninput={() => { adjustmentId = ""; }}></label>
              </div>
              <button class="primary-button" type="submit">Apply auditable adjustment</button>
            </form>
            {#if pendingOperations.length}
              <section class="pending-reservations">
                <h3>Pending reservations</h3>
                <label>Resolution reason<input minlength="5" maxlength="300" placeholder="Verified against the accepted request" bind:value={resolutionReason}></label>
                {#each pendingOperations as operation (operation.id)}
                  <article>
                    <div><strong>{operation.action.replaceAll("_", " ")}</strong><span>{operation.pieceId || "new piece"}</span><code>{operation.id}</code></div>
                    <div class="resolution-actions">
                      <button class="secondary-button" type="button" onclick={() => resolve(operation, "completed")}>Mark completed</button>
                      <button class="secondary-button" type="button" onclick={() => resolve(operation, "released")}>Release credit</button>
                    </div>
                  </article>
                {/each}
              </section>
            {/if}
            <section class="audit-log">
              <h3>Account events</h3>
              <div class="admin-events">
                {#each [...selected.audit].reverse() as event (event.id)}
                  <article class="audit-event"><strong><span>{event.type.replaceAll("_", " ")}</span><time>{formatDate(event.at)}</time></strong><p>{event.message}</p></article>
                {:else}
                  <p class="library-empty">No account events yet.</p>
                {/each}
              </div>
            </section>
          </article>
        {:else}
          <div class="admin-placeholder"><strong>Select an account.</strong><p>Review the provider state, balance, pending operations, and append-only event history.</p></div>
        {/if}
      </div>
      <p class="app-status" aria-live="polite">{status}</p>
    </section>
  </main>
</div>

<style>
  .admin-panel { max-width: var(--size-page); margin: var(--space-0) auto; }
  .admin-heading { display: flex; align-items: end; justify-content: space-between; gap: var(--space-6); margin-bottom: var(--space-7); }
  .admin-heading h1 { margin: var(--space-0) var(--space-0) var(--space-2); font-size: clamp(2.75rem, 5vw, 4.5rem); letter-spacing: -0.05em; }
  .admin-heading p { max-width: 44rem; margin: var(--space-0); color: var(--color-text-muted); font: 1rem/1.6 var(--font-serif); }
  .admin-grid { display: grid; grid-template-columns: minmax(18rem, 0.72fr) minmax(30rem, 1.28fr); align-items: start; gap: var(--space-6); }
  .admin-list-panel, .admin-detail, .admin-placeholder { border: var(--border-thin) solid var(--color-border); background: var(--color-surface); box-shadow: var(--shadow-soft); }
  .admin-list-panel { padding: var(--space-4); }
  .admin-search { display: flex; gap: var(--space-2); margin-bottom: var(--space-4); }
  .admin-search input { margin: var(--space-0); }
  .admin-account-list { display: grid; gap: var(--space-2); }
  .admin-account { width: 100%; padding: var(--space-3); border: var(--border-thin) solid var(--color-border); border-radius: var(--radius-xs); color: var(--color-text); background: var(--color-surface-raised); text-align: left; cursor: pointer; }
  .admin-account:hover, .admin-account.active { border-color: var(--color-action); background: var(--color-action-soft); }
  .admin-account strong { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); font: 600 1rem/1.3 var(--font-serif); }
  .admin-account > span { display: flex; justify-content: space-between; gap: var(--space-3); margin-top: var(--space-2); color: var(--color-text-muted); font-size: 1rem; }
  .admin-detail { padding: var(--space-6); }
  .admin-detail-heading { display: flex; align-items: start; justify-content: space-between; gap: var(--space-4); }
  .admin-detail-heading h2 { margin: var(--space-0) var(--space-0) var(--space-1); font-size: 2rem; }
  .admin-detail-heading p { margin: var(--space-0); color: var(--color-text-subtle); font-size: 1rem; }
  .balance-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--space-2); margin: var(--space-6) var(--space-0); }
  .balance-grid div { padding: var(--space-3); border-top: var(--border-accent) solid var(--color-action); background: var(--color-action-soft); }
  .balance-grid dt { color: var(--color-text-muted); font-size: 1rem; font-weight: 650; }
  .balance-grid dd { margin: var(--space-2) var(--space-0) var(--space-0); font: 600 1.125rem/1.3 var(--font-serif); }
  .adjustment-form { padding: var(--space-5); border: var(--border-thin) solid var(--color-border); background: var(--color-surface-note); }
  .adjustment-form h3, .pending-reservations h3, .audit-log h3 { margin: var(--space-0) var(--space-0) var(--space-4); font-size: 1.25rem; }
  .adjustment-form > div { display: grid; grid-template-columns: 0.35fr 1fr; gap: var(--space-3); }
  .adjustment-form label { margin-bottom: var(--space-0); }
  .adjustment-form .primary-button { margin-top: var(--space-4); }
  .pending-reservations { margin-top: var(--space-5); padding: var(--space-5); border: var(--border-thin) solid var(--color-border); background: var(--color-surface-raised); }
  .pending-reservations > article { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--space-3); padding: var(--space-3) var(--space-0); border-top: var(--border-thin) solid var(--color-border); }
  .pending-reservations > article > div:first-child { display: grid; gap: var(--space-1); min-width: var(--space-0); }
  .pending-reservations span, .pending-reservations code { overflow: hidden; color: var(--color-text-subtle); font-size: 1rem; text-overflow: ellipsis; white-space: nowrap; }
  .resolution-actions { display: flex; align-items: center; gap: var(--space-2); }
  .resolution-actions .secondary-button { padding: var(--space-2) var(--space-3); font-size: 1rem; }
  .audit-log { margin-top: var(--space-6); }
  .admin-events { display: grid; gap: var(--space-2); }
  .audit-event { padding: var(--space-3) var(--space-4); border-left: var(--border-accent) solid var(--color-action-border); background: var(--color-surface-raised); }
  .audit-event strong { display: flex; justify-content: space-between; gap: var(--space-4); font-size: 1rem; }
  .audit-event time { color: var(--color-text-subtle); font-weight: 400; }
  .audit-event p { margin: var(--space-1) var(--space-0) var(--space-0); color: var(--color-text-muted); font-size: 1rem; line-height: 1.5; }
  .admin-placeholder { display: grid; min-height: 26rem; align-content: center; justify-items: center; padding: var(--space-7); text-align: center; }
  .admin-placeholder strong { font: 500 2rem/1.2 var(--font-serif); }
  .admin-placeholder p { max-width: 28rem; color: var(--color-text-muted); font: 1rem/1.6 var(--font-serif); }
  .app-status { margin-top: var(--space-4); }

  @media (max-width: 56rem) {
    .admin-grid { grid-template-columns: 1fr; gap: var(--space-8); }
    .admin-heading { align-items: start; flex-direction: column; }
    .balance-grid { grid-template-columns: 1fr 1fr; }
  }
  @media (max-width: 38rem) {
    .admin-detail { padding: var(--space-4); }
    .admin-detail-heading { flex-direction: column; }
    .adjustment-form > div, .balance-grid { grid-template-columns: 1fr; }
    .pending-reservations > article { grid-template-columns: 1fr; }
    .resolution-actions { align-items: stretch; flex-direction: column; }
  }
</style>
