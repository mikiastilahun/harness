<script lang="ts">
  import { onMount } from "svelte"
  import { goto } from "$app/navigation"
  import { signIn, useSession } from "$lib/auth-client"
  import { Button } from "$lib/components/ui/button"
  import { toast } from "svelte-sonner"
  import { Toaster } from "$lib/components/ui/sonner"
  import Sparkles from "@lucide/svelte/icons/sparkles"
  import Loader from "@lucide/svelte/icons/loader-circle"

  const session = useSession()

  let busy = $state(false)

  onMount(() => {
    if ($session.data) goto("/chat")
  })

  $effect(() => {
    if ($session.data) goto("/chat")
  })

  const onGoogle = async () => {
    busy = true
    const r = await signIn.social({
      provider: "google",
      callbackURL: `${window.location.origin}/chat`,
    })
    if (r.error) {
      busy = false
      toast.error(r.error.message ?? "Sign-in failed")
    }
  }
</script>

<svelte:head>
  <title>Sign in · harness</title>
</svelte:head>

<Toaster position="bottom-right" />

<div class="flex h-dvh items-center justify-center">
  <div class="w-full max-w-sm space-y-6 px-6">
    <div class="text-center">
      <Sparkles class="mx-auto mb-3 size-6 text-muted-foreground" />
      <h1 class="text-lg font-medium">harness</h1>
      <p class="mt-1 text-xs text-muted-foreground">Sign in to continue</p>
    </div>
    <Button class="w-full" onclick={onGoogle} disabled={busy || $session.isPending}>
      {#if busy}
        <Loader class="size-3.5 animate-spin" />
        Redirecting…
      {:else}
        Continue with Google
      {/if}
    </Button>
  </div>
</div>
