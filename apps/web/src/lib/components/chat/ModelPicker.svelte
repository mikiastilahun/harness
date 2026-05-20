<script lang="ts">
  import * as Popover from "$lib/components/ui/popover"
  import { Button } from "$lib/components/ui/button"
  import ChevronDown from "@lucide/svelte/icons/chevron-down"
  import Check from "@lucide/svelte/icons/check"
  import Zap from "@lucide/svelte/icons/zap"
  import Gauge from "@lucide/svelte/icons/gauge"
  import Brain from "@lucide/svelte/icons/brain"
  import {
    PROVIDERS,
    PROVIDER_LABELS,
    PROVIDER_MODELS,
    modelLabel,
    parseModel,
    type Provider,
  } from "$lib/models"
  import { hasKeyFor, type Settings } from "$lib/settings"

  type Props = {
    value: string
    settings: Settings | null
    onSelect: (model: string) => void
  }

  let { value, settings, onSelect }: Props = $props()

  let open = $state(false)

  const currentProvider = $derived(parseModel(value)?.provider ?? null)
  const currentLabel = $derived(modelLabel(value))

  const PROVIDER_DOT: Record<Provider, string> = {
    google: "bg-[#4285f4]",
    openai: "bg-[#10a37f]",
    anthropic: "bg-[#cc785c]",
  }

  const SPEED_ICON = { fast: Zap, mid: Gauge, deep: Brain } as const

  const choose = (id: string, enabled: boolean) => {
    if (!enabled || id === value) {
      open = false
      return
    }
    onSelect(id)
    open = false
  }
</script>

<Popover.Root bind:open>
  <Popover.Trigger>
    {#snippet child({ props })}
      <Button {...props} size="sm" variant="outline" class="h-8 gap-2">
        {#if currentProvider}
          <span class={"size-1.5 rounded-full " + PROVIDER_DOT[currentProvider]}></span>
          <span class="text-[10px] uppercase tracking-wider text-muted-foreground">
            {PROVIDER_LABELS[currentProvider]}
          </span>
        {/if}
        <span class="text-xs">{currentLabel || "Select model"}</span>
        <ChevronDown class="size-3 opacity-50" />
      </Button>
    {/snippet}
  </Popover.Trigger>

  <Popover.Content align="end" class="w-[640px] max-w-[calc(100vw-2rem)] p-0">
    <div class="max-h-[60dvh] overflow-y-auto">
      <div class="space-y-4 p-3">
        {#each PROVIDERS as p (p)}
          {@const hasKey = settings ? hasKeyFor(settings, p) : false}
          <section class="space-y-2">
            <header class="flex items-center justify-between px-1">
              <div class="flex items-center gap-2">
                <span class={"size-2 rounded-full " + PROVIDER_DOT[p]}></span>
                <span class="text-xs font-medium">{PROVIDER_LABELS[p]}</span>
              </div>
              {#if !hasKey}
                <span class="text-[10px] text-muted-foreground">no key set</span>
              {/if}
            </header>
            <div class="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {#each PROVIDER_MODELS[p] as m (m.id)}
                {@const id = `${p}:${m.id}`}
                {@const active = value === id}
                {@const SpeedIcon = SPEED_ICON[m.speed]}
                <button
                  type="button"
                  onclick={() => choose(id, hasKey)}
                  disabled={!hasKey}
                  class={"group relative flex flex-col items-start gap-1 rounded-md border p-2.5 text-left transition-colors " +
                    (active
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted/40") +
                    (!hasKey ? " cursor-not-allowed opacity-50" : "")}
                >
                  <div class="flex w-full items-center justify-between gap-1.5">
                    <SpeedIcon class="size-3 text-muted-foreground" />
                    {#if active}<Check class="size-3 text-primary" />{/if}
                  </div>
                  <span class="text-xs font-medium leading-tight">{m.label}</span>
                  <span class="text-[10px] text-muted-foreground">{m.speed}</span>
                </button>
              {/each}
            </div>
          </section>
        {/each}
      </div>
    </div>
  </Popover.Content>
</Popover.Root>
