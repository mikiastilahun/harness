<script lang="ts">
  import * as Popover from "$lib/components/ui/popover"
  import { Button } from "$lib/components/ui/button"
  import ChevronDown from "@lucide/svelte/icons/chevron-down"
  import Check from "@lucide/svelte/icons/check"
  import Zap from "@lucide/svelte/icons/zap"
  import Gauge from "@lucide/svelte/icons/gauge"
  import Brain from "@lucide/svelte/icons/brain"
  import { MODELS, modelLabel } from "$lib/models"

  type Props = {
    value: string
    onSelect: (model: string) => void
  }

  let { value, onSelect }: Props = $props()

  let open = $state(false)

  const currentLabel = $derived(modelLabel(value))

  const SPEED_ICON = { fast: Zap, mid: Gauge, deep: Brain } as const

  const choose = (id: string) => {
    if (id !== value) onSelect(id)
    open = false
  }
</script>

<Popover.Root bind:open>
  <Popover.Trigger>
    {#snippet child({ props })}
      <Button {...props} size="sm" variant="outline" class="h-8 gap-2">
        <span class="size-1.5 rounded-full bg-[#4285f4]"></span>
        <span class="text-[10px] uppercase tracking-wider text-muted-foreground">Vertex</span>
        <span class="text-xs">{currentLabel || "Select model"}</span>
        <ChevronDown class="size-3 text-muted-foreground" />
      </Button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content class="w-64 p-1" align="end">
    <div class="flex flex-col gap-0.5">
      {#each MODELS as m (m.id)}
        {@const SpeedIcon = SPEED_ICON[m.speed]}
        <button
          type="button"
          onclick={() => choose(m.id)}
          class="flex items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent"
        >
          <div class="flex items-center gap-2">
            <SpeedIcon class="size-3 text-muted-foreground" />
            <span>{m.label}</span>
          </div>
          {#if m.id === value}
            <Check class="size-3 text-muted-foreground" />
          {/if}
        </button>
      {/each}
    </div>
  </Popover.Content>
</Popover.Root>
