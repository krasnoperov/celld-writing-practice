<script>
  import { FOOTER } from "../lib/copy.js";
</script>

<footer class="site-footer">
  <nav aria-label="Site pages">
    {#each FOOTER as [href, label] (href)}
      <a {href}>{label}</a>
    {/each}
  </nav>
</footer>

<style>
  .site-footer { max-width: var(--size-content); margin: var(--space-8) auto var(--space-0); padding: var(--space-4) var(--space-0); border-top: var(--border-thin) solid var(--color-border); }
  .site-footer nav { display: flex; gap: var(--space-5); }
  .site-footer a { color: var(--color-text-subtle); font-size: 1rem; font-weight: 700; text-underline-offset: 0.2rem; }
  .site-footer a:hover { color: var(--color-action); }
</style>
