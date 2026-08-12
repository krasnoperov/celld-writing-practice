<script>
  import { LANDING } from "../lib/copy.js";
  import SiteFooter from "./SiteFooter.svelte";
</script>

<section class="landing">
  <div class="landing-copy">
    <h1>{LANDING.h1} <em>{LANDING.h1Em}</em></h1>
    <p>{LANDING.sub}</p>
    <a class="primary-button" href="auth/github/login">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 .7a11.5 11.5 0 0 0-3.6 22.4c.6.1.8-.3.8-.6v-2.2c-3.4.7-4.1-1.4-4.1-1.4-.5-1.4-1.3-1.8-1.3-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.6.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.8 0C17.2 4.8 18.2 5 18.2 5c.6 1.5.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.4-2.8 5.4-5.5 5.7.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A11.5 11.5 0 0 0 12 .7Z"/></svg>
      Sign in with GitHub
    </a>
    <small>Identity only · no repository permissions</small>
    <p class="terms">{LANDING.terms}</p>
  </div>
  <aside class="sample-notebook" aria-label="Example research note">
    <div class="sample-tab">research</div>
    <h2>A useful tension</h2>
    <p>People say the tool saves time. The interesting question is <mark>whose time, at which stage, and what new work appears later?</mark></p>
    <blockquote>What evidence would change your current view?</blockquote>
    <div class="sample-rule"></div>
    <p class="sample-caption">{LANDING.sample}</p>
  </aside>
</section>
<SiteFooter />

<style>
  .landing { display: grid; grid-template-columns: minmax(0, 0.9fr) minmax(26rem, 1.1fr); align-items: center; gap: var(--space-10); max-width: var(--size-content); min-height: calc(100vh - 12rem); margin: var(--space-0) auto; }
  .landing-copy h1 { max-width: 39rem; margin: var(--space-0) var(--space-0) var(--space-5); font-size: clamp(3.25rem, 6vw, 5.5rem); line-height: 0.93; letter-spacing: -0.055em; }
  .landing-copy h1 em { color: var(--color-action); font-weight: 400; }
  .landing-copy p { max-width: 35rem; margin: var(--space-0); color: var(--color-text-muted); font: 1.25rem/1.6 var(--font-serif); }
  .landing-copy small { display: block; margin-top: var(--space-3); color: var(--color-text-subtle); font-size: 1rem; }
  .landing-copy .terms { max-width: 33rem; margin-top: var(--space-6); color: var(--color-text-subtle); font: 1rem/1.6 var(--font-serif); }
  .landing-copy .primary-button { margin-top: var(--space-5); }
  .sample-notebook { position: relative; min-height: 27rem; padding: var(--space-8) var(--space-7); border: var(--border-thin) solid var(--color-border); background: var(--color-surface); box-shadow: var(--shadow-panel); transform: rotate(0.6deg); }
  .sample-tab { position: absolute; top: calc(var(--space-4) * -1); left: var(--space-6); padding: var(--space-2) var(--space-4); border: var(--border-thin) solid var(--color-border); background: var(--color-action-soft); color: var(--color-action); font-size: 1rem; font-weight: 650; }
  .sample-notebook h2 { margin: var(--space-4) var(--space-0) var(--space-5); font-size: 1.75rem; }
  .sample-notebook > p, .sample-notebook blockquote { font: 1.25rem/1.8 var(--font-serif); }
  .sample-notebook blockquote { margin: var(--space-7) var(--space-0); padding-left: var(--space-5); border-left: var(--border-accent) solid var(--color-action); color: var(--color-action); font-style: italic; }
  .sample-notebook mark { color: inherit; background: linear-gradient(transparent 56%, var(--color-highlight) 56%); }
  .sample-rule { height: var(--border-thin); margin: var(--space-6) var(--space-0); background: var(--color-border); }
  .sample-caption { color: var(--color-text-muted); font: 1rem/1.6 var(--font-sans); }

  @media (max-width: 56rem) {
    .landing { grid-template-columns: 1fr; gap: var(--space-8); padding-top: var(--space-7); }
    .sample-notebook { max-width: 40rem; }
  }
  @media (max-width: 38rem) {
    .landing { min-height: auto; }
    .landing-copy h1 { font-size: 3.125rem; }
    .sample-notebook { min-height: 24rem; padding: var(--space-7) var(--space-5); transform: none; }
  }
</style>
