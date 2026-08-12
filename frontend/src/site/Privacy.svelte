<script>
  // The privacy page must name real processors (GitHub, Polar, OpenAI), so it
  // is exempt from the writer-surface voice scan, like the admin page.
</script>

<div class="site-page">
  <header class="site-header-static">
    <a class="brand" href="/" aria-label="Writing Practice home"><span class="brand-mark">W</span><strong>Writing Practice</strong></a>
    <nav aria-label="Related pages"><a href="/pricing">Pricing</a><a href="/">Try the coach</a></nav>
  </header>
  <main>
    <h1>Privacy</h1>
    <p class="lede">Writing Practice stores what it needs to be your writing desk, and nothing else. No analytics, no trackers, no advertising, one session cookie.</p>

    <h2>What is stored</h2>
    <ul>
      <li><strong>Your identity</strong> — the numeric GitHub ID, login, and avatar URL from GitHub sign-in. The temporary GitHub token is discarded immediately after the profile lookup; the service never receives repository access. The session is a signed cookie that expires after 7 days.</li>
      <li><strong>Your writing</strong> — pieces, briefs, coach notes, and your replies, stored on the service's own infrastructure and readable only by your account.</li>
      <li><strong>Billing state</strong> — subscription status from Polar and a usage ledger of coach sessions. Card details never touch this service; Polar is the merchant of record.</li>
    </ul>

    <h2>Who processes what</h2>
    <ul>
      <li><strong>GitHub</strong> handles sign-in (identity only).</li>
      <li><strong>Polar</strong> handles payment, checkout, and the billing portal.</li>
      <li><strong>OpenAI</strong> receives your brief, your draft, and the coach's earlier notes when you start a piece or explicitly request another coach session, with provider-side storage disabled. Per OpenAI's API terms, this data is not used to train their models. Typing and saving never send your writing to OpenAI.</li>
    </ul>

    <h2>Deletion</h2>
    <p>Deleting a piece removes it and everything on its desk immediately. To delete the whole account, cancel through Manage plan and wait for the paid period to end; the billing screen then offers account deletion. A successful deletion removes every piece, the shelf, the account record, and its billing-audit projection. There is no soft delete and no retention window.</p>

    <h2>Contact</h2>
    <p>Questions about your data: <a href="mailto:aleksei@krasnoperov.me">aleksei@krasnoperov.me</a>.</p>
  </main>
</div>

<style>
  .site-page { max-width: 46rem; margin: 0 auto; padding: var(--space-5) var(--space-5) var(--space-10); }
  .site-header-static { display: flex; align-items: center; justify-content: space-between; min-height: 4.75rem; margin-bottom: var(--space-8); border-bottom: var(--border-thin) solid var(--color-border); }
  .site-header-static nav { display: flex; gap: var(--space-5); }
  .site-header-static nav a { color: var(--color-text-muted); font-size: 1rem; font-weight: 700; text-underline-offset: .2rem; }
  .site-header-static nav a:last-child { color: var(--color-action); }
  h1 { margin: 0 0 var(--space-5); font-size: clamp(2.6rem, 5vw, 4rem); line-height: 0.96; letter-spacing: -0.05em; }
  .lede { margin: 0 0 var(--space-7); color: var(--color-text-soft); font: 1.2rem/1.7 var(--font-serif); }
  h2 { margin: var(--space-8) 0 var(--space-3); font-size: 1.5rem; }
  p, li { color: var(--color-text-soft); font: 1rem/1.7 var(--font-serif); }
  p { margin: 0 0 var(--space-4); }
  ul { margin: 0 0 var(--space-4); padding-left: var(--space-5); }
  li { margin-bottom: var(--space-3); }
</style>
