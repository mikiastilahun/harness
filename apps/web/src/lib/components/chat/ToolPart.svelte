<script lang="ts">
  import * as Collapsible from "$lib/components/ui/collapsible"
  import { Badge } from "$lib/components/ui/badge"
  import Terminal from "@lucide/svelte/icons/terminal"
  import FileText from "@lucide/svelte/icons/file-text"
  import FilePlus from "@lucide/svelte/icons/file-plus"
  import FileEdit from "@lucide/svelte/icons/file-pen"
  import Folder from "@lucide/svelte/icons/folder"
  import Search from "@lucide/svelte/icons/search"
  import Globe from "@lucide/svelte/icons/globe"
  import Package from "@lucide/svelte/icons/package"
  import Wrench from "@lucide/svelte/icons/wrench"
  import Code from "@lucide/svelte/icons/code"
  import ChevronRight from "@lucide/svelte/icons/chevron-right"

  type Props = {
    name: string
    state: string
    input?: unknown
    output?: unknown
    errorText?: string
  }

  let { name, state, input, output, errorText }: Props = $props()

  const ICONS: Record<string, typeof Terminal> = {
    bash: Terminal,
    python: Code,
    read_file: FileText,
    write_file: FilePlus,
    edit_file: FileEdit,
    list_dir: Folder,
    search: Search,
    fetch_url: Globe,
    pip_install: Package,
    apt_install: Package,
  }

  const Icon = $derived(ICONS[name] ?? Wrench)

  type FmtOutput =
    | { kind: "bash"; stdout?: string; stderr?: string; exit?: number; truncated?: boolean }
    | { kind: "file"; content: string }
    | { kind: "fetch"; status: number; body: string }
    | { kind: "search"; output: string; truncated?: boolean }
    | { kind: "json"; value: unknown }

  const sb = $derived.by(() => {
    if (errorText || state === "output-error") return { label: "error", variant: "destructive" as const }
    if (state === "output-available") return { label: "done", variant: "secondary" as const }
    if (state === "input-available") return { label: "running", variant: "outline" as const }
    return { label: "streaming", variant: "outline" as const }
  })

  const f = $derived.by((): FmtOutput | null => {
    if (output === undefined) return null
    if (name === "bash" || name === "python") {
      const o = output as { stdout?: string; stderr?: string; exit?: number; truncated?: boolean }
      return { kind: "bash", ...o }
    }
    if (name === "read_file" && output && typeof output === "object" && "content" in output) {
      return { kind: "file", content: String((output as { content: unknown }).content) }
    }
    if (name === "list_dir" && output && typeof output === "object" && "listing" in output) {
      return { kind: "file", content: String((output as { listing: unknown }).listing) }
    }
    if (name === "search" && output && typeof output === "object" && "output" in output) {
      const o = output as { output: string; truncated?: boolean }
      return { kind: "search", output: o.output, truncated: o.truncated }
    }
    if (name === "fetch_url" && output && typeof output === "object" && "body" in output) {
      const o = output as { status: number; body: string }
      return { kind: "fetch", status: o.status, body: o.body }
    }
    return { kind: "json", value: output }
  })
</script>

<div class="overflow-hidden rounded-lg border border-border/60 bg-muted/30 text-xs">
  <Collapsible.Root>
    <Collapsible.Trigger
      class="group flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/60"
    >
      <ChevronRight class="size-3 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
      <Icon class="size-3.5 text-muted-foreground" />
      <span class="font-mono">{name}</span>
      <Badge variant={sb.variant} class="ml-auto h-4 px-1.5 text-[10px]">{sb.label}</Badge>
    </Collapsible.Trigger>
    <Collapsible.Content>
      <div class="space-y-2 border-t border-border/60 px-3 py-2.5">
        {#if input !== undefined}
          <div>
            <div class="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">input</div>
            <pre
              class="overflow-x-auto rounded-md bg-background/60 p-2 font-mono text-[11px] leading-relaxed">{JSON.stringify(
                input,
                null,
                2,
              )}</pre>
          </div>
        {/if}
        {#if f}
          <div>
            <div class="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">output</div>
            {#if f.kind === "bash"}
              <div class="space-y-1">
                {#if f.stdout}
                  <pre
                    class="max-h-[360px] overflow-auto rounded-md bg-background/60 p-2 font-mono text-[11px] leading-relaxed">{f.stdout}</pre>
                {/if}
                {#if f.stderr}
                  <pre
                    class="max-h-[200px] overflow-auto rounded-md border border-destructive/30 bg-destructive/10 p-2 font-mono text-[11px] leading-relaxed text-destructive">{f.stderr}</pre>
                {/if}
                <div class="flex gap-2 text-[10px] text-muted-foreground">
                  <span>exit {f.exit}</span>
                  {#if f.truncated}<span>· truncated</span>{/if}
                </div>
              </div>
            {:else if f.kind === "file"}
              <pre
                class="max-h-[360px] overflow-auto rounded-md bg-background/60 p-2 font-mono text-[11px] leading-relaxed">{f.content}</pre>
            {:else if f.kind === "search"}
              <pre
                class="max-h-[360px] overflow-auto rounded-md bg-background/60 p-2 font-mono text-[11px] leading-relaxed">{f.output ||
                  "no matches"}</pre>
              {#if f.truncated}<div class="text-[10px] text-muted-foreground">truncated</div>{/if}
            {:else if f.kind === "fetch"}
              <div class="space-y-1">
                <div class="text-[10px] text-muted-foreground">HTTP {f.status}</div>
                <pre
                  class="max-h-[360px] overflow-auto rounded-md bg-background/60 p-2 font-mono text-[11px] leading-relaxed">{f.body}</pre>
              </div>
            {:else}
              <pre
                class="max-h-[360px] overflow-auto rounded-md bg-background/60 p-2 font-mono text-[11px] leading-relaxed">{JSON.stringify(
                  f.value,
                  null,
                  2,
                )}</pre>
            {/if}
          </div>
        {/if}
        {#if errorText}
          <div class="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-[11px] text-destructive">
            {errorText}
          </div>
        {/if}
      </div>
    </Collapsible.Content>
  </Collapsible.Root>
</div>
