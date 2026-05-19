<script lang="ts">
  import { Button } from "$lib/components/ui/button"
  import * as Collapsible from "$lib/components/ui/collapsible"
  import Download from "@lucide/svelte/icons/download"
  import FileIcon from "@lucide/svelte/icons/file"
  import FileText from "@lucide/svelte/icons/file-text"
  import FileCode from "@lucide/svelte/icons/file-code"
  import ImageIcon from "@lucide/svelte/icons/image"
  import ChevronDown from "@lucide/svelte/icons/chevron-down"

  type Props = {
    path: string
    name: string
    mime: string
    size: number
    text?: string
    dataUrl?: string
    downloadUrl: string
  }

  let { path, name, mime, size, text, dataUrl, downloadUrl }: Props = $props()

  const Icon = $derived(
    mime.startsWith("image/")
      ? ImageIcon
      : mime === "application/pdf" || mime === "text/markdown" || mime.startsWith("text/")
        ? FileText
        : mime.includes("script") ||
            mime === "application/json" ||
            mime === "text/x-python" ||
            mime === "application/sql"
          ? FileCode
          : FileIcon,
  )

  const formatBytes = (n: number) => {
    if (n < 1024) return `${n} B`
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
    return `${(n / 1024 / 1024).toFixed(2)} MB`
  }

  const hasPreview = $derived(Boolean(text || dataUrl))
</script>

<div class="overflow-hidden rounded-lg border border-border bg-card">
  <div class="flex items-center gap-3 p-3">
    <div class="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
      <Icon class="size-4" />
    </div>
    <div class="min-w-0 flex-1">
      <div class="truncate text-sm font-medium">{name}</div>
      <div class="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
        <span class="font-mono">{path}</span>
        <span>·</span>
        <span>{formatBytes(size)}</span>
        <span>·</span>
        <span>{mime}</span>
      </div>
    </div>
    <Button href={downloadUrl} target="_blank" rel="noopener" size="sm" variant="outline" class="shrink-0">
      <Download class="size-3.5" />
      Download
    </Button>
  </div>

  {#if hasPreview}
    <Collapsible.Root>
      <Collapsible.Trigger
        class="group flex w-full items-center justify-center gap-1.5 border-t border-border py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted/40"
      >
        <span>Preview</span>
        <ChevronDown class="size-3 transition-transform group-data-[state=open]:rotate-180" />
      </Collapsible.Trigger>
      <Collapsible.Content>
        <div class="border-t border-border p-3">
          {#if dataUrl}
            <img src={dataUrl} alt={name} class="mx-auto max-h-[400px] max-w-full rounded-md object-contain" />
          {:else if text !== undefined}
            <pre
              class="max-h-[360px] overflow-auto rounded-md bg-background/60 p-2 font-mono text-[11px] leading-relaxed">{text}</pre>
          {/if}
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  {/if}
</div>
