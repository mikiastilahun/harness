<script lang="ts">
  import { onMount } from "svelte"
  import { goto } from "$app/navigation"
  import { Button } from "$lib/components/ui/button"
  import { Input } from "$lib/components/ui/input"
  import { Badge } from "$lib/components/ui/badge"
  import * as Card from "$lib/components/ui/card"
  import { Separator } from "$lib/components/ui/separator"
  import { Toaster } from "$lib/components/ui/sonner"
  import { toast } from "svelte-sonner"
  import ArrowLeft from "@lucide/svelte/icons/arrow-left"
  import Sparkles from "@lucide/svelte/icons/sparkles"
  import Check from "@lucide/svelte/icons/check"
  import Loader from "@lucide/svelte/icons/loader-circle"
  import { signOut, useSession } from "$lib/auth-client"
  import { PROVIDERS, PROVIDER_LABELS, PROVIDER_KEY_LABEL, PROVIDER_KEY_HINT, type Provider } from "$lib/models"
  import { getSettings, updateSettings, hasKeyFor, type Settings } from "$lib/settings"

  const session = useSession()

  let loaded = $state(false)
  let saving = $state(false)
  let settings = $state<Settings | null>(null)
  let provider = $state<Provider | null>(null)
  let keys = $state<Record<Provider, string>>({ google: "", openai: "", anthropic: "" })

  const initial = async () => {
    try {
      const s = await getSettings()
      settings = s
      provider = s.provider
      loaded = true
    } catch (e) {
      toast.error(`Load failed: ${(e as Error).message}`)
    }
  }

  $effect(() => {
    if (!$session.isPending && !$session.data) goto("/signin")
  })

  onMount(initial)

  const onSave = async () => {
    if (!provider) {
      toast.error("Pick a provider first")
      return
    }
    saving = true
    const patch: Record<string, string | Provider | null> = { provider }
    const newKey = keys[provider].trim()
    if (newKey) patch[`${provider}_api_key`] = newKey
    try {
      const s = await updateSettings(patch)
      settings = s
      keys[provider] = ""
      toast.success("Saved")
    } catch (e) {
      toast.error(`Save failed: ${(e as Error).message}`)
    }
    saving = false
  }

  const onClearKey = async (p: Provider) => {
    try {
      const s = await updateSettings({ [`${p}_api_key`]: null })
      settings = s
      toast.success(`${PROVIDER_LABELS[p]} key removed`)
    } catch (e) {
      toast.error(`Remove failed: ${(e as Error).message}`)
    }
  }

  const onSignOut = async () => {
    await signOut()
    goto("/signin")
  }
</script>

<svelte:head>
  <title>Settings · harness</title>
</svelte:head>

<Toaster position="bottom-right" />

<div class="min-h-dvh">
  <header class="border-b border-border">
    <div class="mx-auto flex max-w-2xl items-center justify-between px-4 py-3 sm:px-6">
      <Button variant="ghost" size="sm" onclick={() => goto("/chat")}>
        <ArrowLeft class="size-3.5" />
        Back to chat
      </Button>
      <div class="flex items-center gap-1.5">
        <Sparkles class="size-4 text-muted-foreground" />
        <span class="text-sm font-medium">harness</span>
      </div>
    </div>
  </header>

  <main class="mx-auto max-w-2xl space-y-6 px-4 py-8 sm:px-6">
    <Card.Root>
      <Card.Header>
        <Card.Title>Profile</Card.Title>
        <Card.Description>Signed in via Google.</Card.Description>
      </Card.Header>
      <Card.Content class="space-y-3">
        {#if $session.data}
          <div class="flex items-center gap-3">
            {#if $session.data.user.image}
              <img src={$session.data.user.image} alt="" class="size-10 rounded-full" />
            {:else}
              <div class="flex size-10 items-center justify-center rounded-full bg-muted text-xs">
                {$session.data.user.name?.[0]?.toUpperCase() ?? "?"}
              </div>
            {/if}
            <div class="min-w-0">
              <div class="truncate text-sm font-medium">{$session.data.user.name}</div>
              <div class="truncate text-xs text-muted-foreground">{$session.data.user.email}</div>
            </div>
          </div>
        {/if}
      </Card.Content>
      <Card.Footer>
        <Button variant="outline" size="sm" onclick={onSignOut}>Sign out</Button>
      </Card.Footer>
    </Card.Root>

    <Card.Root>
      <Card.Header>
        <Card.Title>LLM provider</Card.Title>
        <Card.Description>
          Bring your own API key. Keys are encrypted at rest with AES-256-GCM before being stored.
        </Card.Description>
      </Card.Header>
      <Card.Content class="space-y-5">
        {#if !loaded}
          <div class="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader class="size-3 animate-spin" />
            Loading…
          </div>
        {:else}
          <div class="space-y-2">
            <div class="text-xs font-medium uppercase tracking-wider text-muted-foreground">Provider</div>
            <div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {#each PROVIDERS as p (p)}
                {@const active = provider === p}
                {@const has = settings && hasKeyFor(settings, p)}
                <button
                  type="button"
                  onclick={() => (provider = p)}
                  class={"flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors " +
                    (active
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted/40")}
                >
                  <div class="flex w-full items-center justify-between">
                    <span class="text-sm font-medium">{PROVIDER_LABELS[p]}</span>
                    {#if active}<Check class="size-3.5 text-primary" />{/if}
                  </div>
                  {#if has}
                    <Badge variant="outline" class="text-[10px]">key set</Badge>
                  {:else}
                    <span class="text-[11px] text-muted-foreground">no key yet</span>
                  {/if}
                </button>
              {/each}
            </div>
          </div>

          <Separator />

          {#if provider}
            <div class="space-y-2">
              <div class="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {PROVIDER_KEY_LABEL[provider]}
              </div>
              <Input
                type="password"
                placeholder={settings && hasKeyFor(settings, provider) ? "•••••• (leave blank to keep current)" : "Paste your key"}
                bind:value={keys[provider]}
                autocomplete="off"
              />
              <div class="text-[11px] text-muted-foreground">{PROVIDER_KEY_HINT[provider]}</div>
              {#if settings && hasKeyFor(settings, provider)}
                <button
                  type="button"
                  class="text-[11px] text-destructive underline-offset-4 hover:underline"
                  onclick={() => onClearKey(provider!)}
                >
                  Remove saved key
                </button>
              {/if}
            </div>
          {/if}
        {/if}
      </Card.Content>
      <Card.Footer class="justify-end">
        <Button onclick={onSave} disabled={!loaded || saving || !provider}>
          {#if saving}
            <Loader class="size-3.5 animate-spin" />
            Saving…
          {:else}
            Save
          {/if}
        </Button>
      </Card.Footer>
    </Card.Root>
  </main>
</div>
