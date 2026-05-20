<script lang="ts">
  import { onMount, tick, untrack } from "svelte"
  import { goto } from "$app/navigation"
  import type { UIMessage } from "ai"
  import { Chat } from "@ai-sdk/svelte"
  import { DefaultChatTransport } from "ai"
  import { Badge } from "$lib/components/ui/badge"
  import { Button } from "$lib/components/ui/button"
  import { ScrollArea } from "$lib/components/ui/scroll-area"
  import ModelPicker from "$lib/components/chat/ModelPicker.svelte"
  import { Toaster } from "$lib/components/ui/sonner"
  import { toast } from "svelte-sonner"
  import Sidebar from "$lib/components/chat/Sidebar.svelte"
  import ToolPart from "$lib/components/chat/ToolPart.svelte"
  import FileCard from "$lib/components/chat/FileCard.svelte"
  import MarkdownView from "$lib/components/chat/MarkdownView.svelte"
  import Composer from "$lib/components/chat/Composer.svelte"
  import Sparkles from "@lucide/svelte/icons/sparkles"
  import User from "@lucide/svelte/icons/user"
  import LogOut from "@lucide/svelte/icons/log-out"
  import Loader from "@lucide/svelte/icons/loader-circle"
  import Sun from "@lucide/svelte/icons/sun"
  import Moon from "@lucide/svelte/icons/moon"
  import SettingsIcon from "@lucide/svelte/icons/settings"
  import { mode, toggleMode } from "mode-watcher"
  import { signOut, useSession } from "$lib/auth-client"
  import {
    type Thread,
    listThreads,
    createThread,
    getThread,
    updateThread,
    deleteThread,
    titleFromMessages,
  } from "$lib/threads"
  import { defaultModelFor, parseModel } from "$lib/models"
  import { getSettings, isConfigured, type Settings } from "$lib/settings"

  const SAVE_DEBOUNCE_MS = 1500

  let threads = $state<Thread[]>([])
  let activeId = $state<string | null>(null)
  let chat = $state<Chat | null>(null)
  let viewportRef = $state<HTMLElement | null>(null)
  let pendingTimer: ReturnType<typeof setTimeout> | null = null
  let pendingThreadId: string | null = null
  let pendingMessages: UIMessage[] | null = null
  let settings = $state<Settings | null>(null)

  const active = $derived(threads.find((t) => t.id === activeId) ?? null)
  const isBusy = $derived(chat?.status === "submitted" || chat?.status === "streaming")
  const currentModel = $derived<string>(
    active?.model ?? (settings?.provider ? defaultModelFor(settings.provider) : ""),
  )

  const makeChat = (t: Thread, initial: UIMessage[]) =>
    new Chat({
      messages: initial,
      transport: new DefaultChatTransport({
        api: "/api/chat",
        body: () => ({ model: t.model, sessionId: t.sandbox_session_id }),
      }),
      onError: (e) => toast.error(e.message),
    })

  const flushSave = async () => {
    if (pendingTimer) {
      clearTimeout(pendingTimer)
      pendingTimer = null
    }
    if (!pendingThreadId || !pendingMessages) return
    const id = pendingThreadId
    const messages = pendingMessages
    pendingThreadId = null
    pendingMessages = null
    const t = threads.find((x) => x.id === id)
    const title = (t && titleFromMessages(messages)) ?? t?.title ?? "New chat"
    try {
      const updated = await updateThread(id, { title, messages })
      threads = threads
        .map((x) => (x.id === updated.id ? { ...x, title: updated.title, updated_at: updated.updated_at } : x))
        .sort((a, b) => b.updated_at - a.updated_at)
    } catch (e) {
      toast.error(`Save failed: ${(e as Error).message}`)
    }
  }

  const schedulePersist = (id: string, messages: UIMessage[]) => {
    pendingThreadId = id
    pendingMessages = messages
    if (pendingTimer) clearTimeout(pendingTimer)
    pendingTimer = setTimeout(() => {
      pendingTimer = null
      flushSave()
    }, SAVE_DEBOUNCE_MS)
  }

  const setActive = async (t: Thread) => {
    if (activeId && activeId !== t.id) await flushSave()
    activeId = t.id
    const full = await getThread(t.id)
    let effective: Thread = t
    if (!parseModel(t.model) && settings?.provider) {
      const migratedModel = defaultModelFor(settings.provider)
      const updated = await updateThread(t.id, { model: migratedModel })
      effective = { ...t, model: updated.model, updated_at: updated.updated_at }
      threads = threads.map((x) => (x.id === effective.id ? effective : x))
    }
    chat = makeChat(effective, full.messages)
  }

  const startNew = async () => {
    await flushSave()
    if (!settings?.provider) {
      toast.error("Configure an LLM provider in Settings first")
      goto("/settings")
      return
    }
    try {
      const t = await createThread(defaultModelFor(settings.provider))
      threads = [t, ...threads]
      activeId = t.id
      chat = makeChat(t, t.messages)
    } catch (e) {
      toast.error(`Create failed: ${(e as Error).message}`)
    }
  }

  const removeThread = async (id: string) => {
    try {
      await deleteThread(id)
    } catch (e) {
      toast.error(`Delete failed: ${(e as Error).message}`)
      return
    }
    threads = threads.filter((t) => t.id !== id)
    if (activeId === id) {
      activeId = null
      chat = null
      if (threads.length > 0) await setActive(threads[0]!)
      else await startNew()
    }
  }

  const changeModel = async (m: string) => {
    if (!active) return
    try {
      const updated = await updateThread(active.id, { model: m })
      threads = threads
        .map((t) => (t.id === updated.id ? { ...t, model: updated.model, updated_at: updated.updated_at } : t))
        .sort((a, b) => b.updated_at - a.updated_at)
      const t = threads.find((x) => x.id === updated.id)
      if (chat && t) chat = makeChat(t, chat.messages)
    } catch (e) {
      toast.error(`Update failed: ${(e as Error).message}`)
    }
  }

  const session = useSession()

  onMount(async () => {
    try {
      const s = await getSettings()
      settings = s
      if (!isConfigured(s)) {
        goto("/settings")
        return
      }
      const initial = await listThreads()
      threads = initial
      if (initial.length === 0) await startNew()
      else await setActive(initial[0]!)
    } catch (e) {
      toast.error(`Load failed: ${(e as Error).message}`)
    }
  })

  $effect(() => {
    if (!$session.isPending && !$session.data) goto("/signin")
  })

  const onSignOut = async () => {
    await flushSave()
    await signOut()
    goto("/signin")
  }

  // Schedule debounced save whenever messages change; flush immediately on stream completion.
  $effect(() => {
    const c = chat
    if (!c || !activeId) return
    const len = c.messages.length
    const status = c.status
    const id = activeId
    untrack(() => {
      const snapshot = $state.snapshot(c.messages) as UIMessage[]
      if (status === "ready" || status === "error") {
        if (len === 0) return
        pendingThreadId = id
        pendingMessages = snapshot
        flushSave()
        return
      }
      schedulePersist(id, snapshot)
    })
    if (viewportRef) {
      tick().then(() => {
        viewportRef!.scrollTop = viewportRef!.scrollHeight
      })
    }
  })

  const sendWithFiles = (text: string, attachedPaths: string[]) => {
    if (!chat) return
    const intro = attachedPaths.length === 0
      ? text
      : (text
          ? `${text}\n\n`
          : "") +
        `Attached file${attachedPaths.length > 1 ? "s" : ""}: ${attachedPaths.map((p) => `\`${p}\``).join(", ")}`
    if (!intro.trim()) return
    chat.sendMessage({ text: intro })
  }

  const EXAMPLES = [
    {
      title: "Beam deflection",
      prompt:
        "Compute the center deflection of a simply-supported beam: L=10m, w=5kN/m, E=200GPa, I=8000cm⁴. Use python, save the script as /workspace/beam.py and attach it to chat.",
    },
    {
      title: "Concrete mix",
      prompt:
        "Design a concrete mix for 35 MPa target strength. Use ACI 211.1 with appropriate assumptions. Show the table of quantities per m³ as a markdown file at /workspace/mix.md and attach it.",
    },
    {
      title: "Project schedule",
      prompt:
        "Write a Python script using pandas that reads a CSV of construction tasks (id, name, duration_days, depends_on) and computes the critical path. Generate a sample CSV first, save both files, attach them.",
    },
    {
      title: "Pull a standard",
      prompt:
        "Fetch the homepage at https://www.osha.gov and list the top 5 construction safety topics mentioned.",
    },
  ]

  const useExample = (prompt: string) => {
    if (isBusy || !chat) return
    chat.sendMessage({ text: prompt })
  }
</script>

<svelte:head>
  <title>harness</title>
</svelte:head>

<Toaster position="bottom-right" />

<div class="flex h-dvh overflow-hidden">
  <Sidebar {threads} {activeId} onSelect={setActive} onNew={startNew} onDelete={removeThread} />

  <main class="flex min-h-0 min-w-0 flex-1 flex-col">
    <header class="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
      <div class="flex min-w-0 items-center gap-2">
        <div class="truncate text-sm font-medium">{active?.title ?? "harness"}</div>
        {#if active}
          <Badge variant="outline" class="hidden font-mono text-[10px] sm:inline-flex">
            sb:{active.sandbox_session_id.slice(0, 8)}
          </Badge>
        {/if}
      </div>
      <div class="flex items-center gap-2">
        <ModelPicker value={currentModel} {settings} onSelect={changeModel} />
        <Button size="icon" variant="ghost" class="size-8" onclick={() => goto("/settings")} aria-label="Settings">
          <SettingsIcon class="size-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          class="size-8"
          onclick={toggleMode}
          aria-label={mode.current === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {#if mode.current === "dark"}
            <Sun class="size-3.5" />
          {:else}
            <Moon class="size-3.5" />
          {/if}
        </Button>
        {#if $session.data}
          <span class="hidden text-xs text-muted-foreground sm:inline">{$session.data.user.email}</span>
          <Button size="icon" variant="ghost" class="size-8" onclick={onSignOut} aria-label="Sign out">
            <LogOut class="size-3.5" />
          </Button>
        {/if}
      </div>
    </header>

    <ScrollArea class="min-h-0 flex-1" bind:viewportRef>
      <div class="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
        {#if !chat || chat.messages.length === 0}
          <div class="mx-auto mt-12 max-w-2xl">
            <div class="mb-6 text-center">
              <Sparkles class="mx-auto mb-3 size-6 text-muted-foreground" />
              <h2 class="text-base font-medium">How can I help with this project?</h2>
              <p class="mt-1 text-xs text-muted-foreground">
                The agent has a kata-isolated sandbox with python, node, bash. Attach files to the composer and the
                agent can read them; it will attach its deliverables back to chat.
              </p>
            </div>
            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {#each EXAMPLES as ex (ex.title)}
                <button
                  type="button"
                  onclick={() => useExample(ex.prompt)}
                  class="rounded-lg border border-border bg-card/60 p-3 text-left transition-colors hover:bg-card disabled:opacity-50"
                  disabled={isBusy}
                >
                  <div class="text-xs font-medium">{ex.title}</div>
                  <div class="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{ex.prompt}</div>
                </button>
              {/each}
            </div>
          </div>
        {/if}

        {#if chat}
          {#key activeId}
          <div class="space-y-6">
            {#each chat.messages as message (message.id)}
              <div class="flex gap-3">
                <div
                  class="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-card"
                >
                  {#if message.role === "user"}
                    <User class="size-3.5 text-muted-foreground" />
                  {:else}
                    <Sparkles class="size-3.5 text-muted-foreground" />
                  {/if}
                </div>
                <div class="min-w-0 flex-1 space-y-2">
                  <div class="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {message.role}
                  </div>
                  {#each message.parts as part, i (i)}
                    {#if part.type === "text"}
                      {#if message.role === "assistant"}
                        <MarkdownView text={part.text} />
                      {:else}
                        <div class="text-sm leading-relaxed whitespace-pre-wrap">{part.text}</div>
                      {/if}
                    {:else if part.type === "tool-attach_file_to_chat" && (part as any).state === "output-available" && (part as any).output}
                      <FileCard {...((part as any).output)} />
                    {:else if String(part.type).startsWith("tool-")}
                      <ToolPart
                        name={String(part.type).slice(5)}
                        state={(part as any).state ?? ""}
                        input={(part as any).input}
                        output={(part as any).output}
                        errorText={(part as any).errorText}
                      />
                    {/if}
                  {/each}
                </div>
              </div>
            {/each}
            {#if isBusy}
              <div class="flex items-center gap-2 pl-10 text-xs text-muted-foreground">
                <Loader class="size-3 animate-spin" />
                {chat.status === "submitted" ? "thinking…" : "streaming…"}
              </div>
            {/if}
          </div>
          {/key}
        {/if}
      </div>
    </ScrollArea>

    <div class="border-t border-border bg-background px-4 py-3 sm:px-6">
      {#if active}
        <Composer sessionId={active.sandbox_session_id} disabled={isBusy} onSend={sendWithFiles} />
      {/if}
    </div>
  </main>
</div>
