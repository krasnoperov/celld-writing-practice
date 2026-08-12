<script>
  import { app } from "../lib/state.svelte.js";
  import { createPiece, deleteAccount, openDesk, run } from "../lib/actions.js";
  import { ACCOUNT, SHELF } from "../lib/copy.js";
  import SiteFooter from "./SiteFooter.svelte";

  let subject = $state("");
  let aim = $state("");
  const subscriptionActive = $derived(["active", "trialing"].includes(app.billing?.subscription?.status));

  function stateLine(status) {
    if (!status?.exists) return "Unavailable";
    if (status.activeJob?.kind === "reading") return "Your coach is reading";
    if (status.activeJob) return "Your coach is working";
    if (status.awaitingVerdict) return "A letter is waiting on your revision";
    return "Resting";
  }

  function touched(item) {
    const at = item.status?.updatedAt ?? item.createdAt;
    const date = new Date(at);
    return Number.isFinite(date.getTime()) ? date.toLocaleDateString([], { dateStyle: "medium" }) : "";
  }

  function start(event) {
    event.preventDefault();
    run(async () => {
      await createPiece({ subject, aim });
      subject = aim = "";
    });
  }

  function removeAccount() {
    if (!confirm(ACCOUNT.confirm)) return;
    run(deleteAccount);
  }
</script>

<section class="shelf">
  <form class="question" onsubmit={start}>
    <h1>{SHELF.question}</h1>
    <input class="subject" required minlength="3" placeholder={SHELF.subjectPlaceholder} bind:value={subject} aria-label={SHELF.question}>
    <label class="aim">{SHELF.aimLabel}<input bind:value={aim}></label>
    <button class="primary-button" type="submit">{SHELF.start} <span>→</span></button>
  </form>

  {#if app.pieces.length}
    <div class="pieces">
      {#each app.pieces as item (item.id)}
        <button class="piece-card" type="button" onclick={() => run(() => openDesk(item.id))}>
          <strong>{item.status.brief?.subject}</strong>
          <span>{stateLine(item.status)}</span>
          <small>{touched(item)}</small>
        </button>
      {/each}
    </div>
  {:else}
    <p class="shelf-empty">{SHELF.empty}</p>
  {/if}
  <p class="app-status" aria-live="polite">{app.status}</p>

  {#if !subscriptionActive}
    <div class="account-foot">
      <button class="text-button" type="button" onclick={removeAccount}>{ACCOUNT.deleteAccount}</button>
    </div>
  {/if}
  <SiteFooter />
</section>

<style>
  .shelf { max-width: 52rem; margin: var(--space-7) auto var(--space-0); }
  .question h1 { margin: var(--space-0) var(--space-0) var(--space-5); font-size: clamp(2.5rem, 5vw, 3.75rem); letter-spacing: -0.045em; line-height: var(--leading-tight); }
  .subject { padding: var(--space-4); font: 1.25rem/1.5 var(--font-serif); }
  .aim { margin-top: var(--space-4); }
  .question .primary-button { margin-top: var(--space-4); }
  .pieces { display: grid; grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr)); gap: var(--space-3); margin-top: var(--space-8); }
  .piece-card { display: grid; gap: var(--space-1); padding: var(--space-4); border: var(--border-thin) solid var(--color-border); border-radius: var(--radius-xs); background: var(--color-surface); cursor: pointer; text-align: left; }
  .piece-card:hover { border-color: var(--color-action); background: var(--color-action-soft); }
  .piece-card strong { overflow: hidden; font: 600 1.0625rem/1.35 var(--font-serif); color: var(--color-text); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .piece-card span { color: var(--color-text-muted); font-size: 1rem; }
  .piece-card small { color: var(--color-text-subtle); font-size: 1rem; }
  .shelf-empty { margin-top: var(--space-8); color: var(--color-text-muted); font: 1rem/1.6 var(--font-serif); }
  .app-status { margin-top: var(--space-5); }
  .account-foot { margin-top: var(--space-9); }
  .account-foot .text-button { color: var(--color-text-subtle); font-size: 1rem; }
  .account-foot .text-button:hover { color: var(--color-danger); }
</style>
