<script lang="ts">
  import { Button } from "$lib/components/ui/button"
  import { ScrollArea } from "$lib/components/ui/scroll-area"
  import { Separator } from "$lib/components/ui/separator"
  import { type Thread, formatTime } from "$lib/threads"
  import Plus from "@lucide/svelte/icons/plus"
  import Sparkles from "@lucide/svelte/icons/sparkles"
  import Trash2 from "@lucide/svelte/icons/trash-2"
  import { cn } from "$lib/utils"

  type Props = {
    threads: Thread[]
    activeId: string | null
    onSelect: (t: Thread) => void
    onNew: () => void
    onDelete: (id: string) => void
  }

  let { threads, activeId, onSelect, onNew, onDelete }: Props = $props()
</script>

<aside class="flex h-full w-64 shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground">
  <div class="flex items-center justify-between px-3 py-3">
    <div class="flex items-center gap-1.5">
      <Sparkles class="size-4 text-sidebar-foreground" />
      <span class="text-sm font-semibold tracking-tight">harness</span>
    </div>
  </div>

  <div class="px-2 pb-2">
    <Button onclick={onNew} variant="outline" size="sm" class="w-full justify-start gap-2">
      <Plus class="size-3.5" />
      New chat
    </Button>
  </div>

  <Separator />

  <ScrollArea class="flex-1">
    <div class="p-2">
      {#if threads.length === 0}
        <div class="px-2 py-6 text-center text-xs text-muted-foreground">No chats yet.</div>
      {/if}
      {#each threads as t (t.id)}
        <div
          role="button"
          tabindex="0"
          onclick={() => onSelect(t)}
          onkeydown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault()
              onSelect(t)
            }
          }}
          class={cn(
            "group flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-xs transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            t.id === activeId
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "hover:bg-sidebar-accent/50",
          )}
        >
          <div class="min-w-0 flex-1">
            <div class="truncate text-[13px] leading-tight">{t.title || "Untitled"}</div>
            <div class="mt-0.5 text-[10px] text-muted-foreground">{formatTime(t.updated_at)}</div>
          </div>
          <button
            type="button"
            aria-label="Delete chat"
            onclick={(e) => {
              e.stopPropagation()
              onDelete(t.id)
            }}
            class="opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
          >
            <Trash2 class="size-3.5" />
          </button>
        </div>
      {/each}
    </div>
  </ScrollArea>

</aside>
