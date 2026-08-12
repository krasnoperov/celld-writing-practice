<script>
  const included = [
    ["A reading", "Starting a piece requests its first sourced, cited reading. You can ask for up to two more rounds."],
    ["A letter", "One strength worth protecting, the one problem that matters, one move. Never a rewrite."],
    ["A verdict", "After you revise, your coach reads the piece as it stands — and says plainly if it's ready."],
    ["Margin notes", "When you ask, small notes are pinned to exact sentences — clarity, order, usage — with reference phrasings you retype in your own hand."],
    ["A direct answer", "A question you send from the correspondence box uses one session and returns an answer about this piece."],
  ];
</script>

<div class="site-page">
  <header class="site-header-static">
    <a class="brand" href="/" aria-label="Writing Practice home"><span class="brand-mark">W</span><strong>Writing Practice</strong></a>
    <nav aria-label="Related pages"><a href="/privacy">Privacy</a><a href="/">Try the coach</a></nav>
  </header>
  <main>
    <h1>One plan. Your words.</h1>
    <p class="lede">Writing Practice is a paid monthly practice: <strong>50 coach sessions a month</strong>, every piece on its own desk, kept as long as you need. The exact price is shown at checkout, and payment is handled by Polar — cancel anytime from Manage plan.</p>

    <h2>What counts as a session</h2>
    <p>A session is one pass you explicitly start. Creating a piece starts its first reading; later passes start only when you press a coach action. Writing, saving, editing your brief, and writing back never start a session.</p>
    <dl>
      {#each included as [name, line] (name)}
        <dt>{name}</dt>
        <dd>{line}</dd>
      {/each}
    </dl>

    <h2>What you keep</h2>
    <p>Your writing is yours. The coach never writes into your text — there is no apply button anywhere — so everything on the page is in your own hand. You can delete a piece at any time, and delete the whole account after the subscription ends.</p>

    <p class="cta"><a class="primary-button" href="/">Start with a subject you care about <span>→</span></a></p>
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
  p { margin: 0 0 var(--space-4); color: var(--color-text-soft); font: 1rem/1.7 var(--font-serif); }
  dl { margin: var(--space-5) 0 0; }
  dt { margin-top: var(--space-4); color: var(--color-action); font: 650 1rem/1.4 var(--font-sans); }
  dd { margin: var(--space-1) 0 0; color: var(--color-text-soft); font: 1rem/1.65 var(--font-serif); }
  .cta { margin-top: var(--space-8); }
</style>
