<script lang="ts">
  import { renderMarkdown } from "$lib/markdown"

  let { text }: { text: string } = $props()
  let html = $state("")

  $effect(() => {
    const t = text
    let cancelled = false
    renderMarkdown(t).then((h) => {
      if (!cancelled) html = h
    })
    return () => {
      cancelled = true
    }
  })
</script>

<div class="prose-harness max-w-none">
  {@html html}
</div>

<style>
  :global(.prose-harness) {
    font-size: 0.875rem;
    line-height: 1.65;
    color: var(--foreground);
  }
  :global(.prose-harness p) {
    margin: 0.5em 0;
  }
  :global(.prose-harness p:first-child) {
    margin-top: 0;
  }
  :global(.prose-harness p:last-child) {
    margin-bottom: 0;
  }
  :global(.prose-harness h1),
  :global(.prose-harness h2),
  :global(.prose-harness h3),
  :global(.prose-harness h4) {
    font-weight: 600;
    line-height: 1.3;
    margin: 1em 0 0.4em;
  }
  :global(.prose-harness h1) {
    font-size: 1.25rem;
  }
  :global(.prose-harness h2) {
    font-size: 1.125rem;
  }
  :global(.prose-harness h3) {
    font-size: 1rem;
  }
  :global(.prose-harness ul),
  :global(.prose-harness ol) {
    margin: 0.5em 0;
    padding-left: 1.5em;
  }
  :global(.prose-harness li) {
    margin: 0.15em 0;
  }
  :global(.prose-harness ul) {
    list-style: disc;
  }
  :global(.prose-harness ol) {
    list-style: decimal;
  }
  :global(.prose-harness a) {
    color: var(--primary);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  :global(.prose-harness code) {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.85em;
    background: var(--muted);
    padding: 0.1em 0.35em;
    border-radius: 0.25rem;
  }
  :global(.prose-harness pre) {
    margin: 0.75em 0;
    padding: 0.75em;
    border-radius: 0.5rem;
    overflow-x: auto;
    font-size: 0.8rem;
    line-height: 1.5;
    background: oklch(0.18 0.005 286);
    border: 1px solid var(--border);
  }
  :global(.prose-harness pre code) {
    background: transparent;
    padding: 0;
    font-size: inherit;
  }
  :global(.prose-harness blockquote) {
    border-left: 3px solid var(--border);
    padding-left: 0.75em;
    color: var(--muted-foreground);
    margin: 0.75em 0;
  }
  :global(.prose-harness table) {
    border-collapse: collapse;
    margin: 0.75em 0;
    font-size: 0.85rem;
  }
  :global(.prose-harness th),
  :global(.prose-harness td) {
    border: 1px solid var(--border);
    padding: 0.4em 0.6em;
    text-align: left;
  }
  :global(.prose-harness th) {
    background: var(--muted);
    font-weight: 600;
  }
  :global(.prose-harness hr) {
    border: 0;
    border-top: 1px solid var(--border);
    margin: 1em 0;
  }
</style>
