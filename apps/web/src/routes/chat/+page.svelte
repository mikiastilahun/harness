<script lang="ts">
  import { onMount, tick, untrack } from "svelte"
  import type { UIMessage } from "ai"
  import { Chat } from "@ai-sdk/svelte"
  import { DefaultChatTransport } from "ai"
  import { Badge } from "$lib/components/ui/badge"
  import { Button } from "$lib/components/ui/button"
  import { ScrollArea } from "$lib/components/ui/scroll-area"
  import ModelPicker from "$lib/components/chat/ModelPicker.svelte"
  import SkillsPicker from "$lib/components/chat/SkillsPicker.svelte"
  import { Toaster } from "$lib/components/ui/sonner"
  import { toast } from "svelte-sonner"
  import Sidebar from "$lib/components/chat/Sidebar.svelte"
  import ToolPart from "$lib/components/chat/ToolPart.svelte"
  import FileCard from "$lib/components/chat/FileCard.svelte"
  import MarkdownView from "$lib/components/chat/MarkdownView.svelte"
  import Composer from "$lib/components/chat/Composer.svelte"
  import Sparkles from "@lucide/svelte/icons/sparkles"
  import User from "@lucide/svelte/icons/user"
  import Loader from "@lucide/svelte/icons/loader-circle"
  import Sun from "@lucide/svelte/icons/sun"
  import Moon from "@lucide/svelte/icons/moon"
  import { mode, toggleMode } from "mode-watcher"
  import {
    type Thread,
    listThreads,
    createThread,
    getThread,
    updateThread,
    deleteThread,
    titleFromMessages,
  } from "$lib/threads"
  import { DEFAULT_MODEL, isValidModel } from "$lib/models"
  import type { AttachedSkill } from "$lib/skills"

  const SAVE_DEBOUNCE_MS = 800

  let threads = $state<Thread[]>([])
  let activeId = $state<string | null>(null)
  let chat = $state<Chat | null>(null)
  let viewportRef = $state<HTMLElement | null>(null)
  let pendingTimer: ReturnType<typeof setTimeout> | null = null
  let pendingThreadId: string | null = null
  let pendingMessages: UIMessage[] | null = null

  const active = $derived(threads.find((t) => t.id === activeId) ?? null)
  const isBusy = $derived(chat?.status === "submitted" || chat?.status === "streaming")
  const currentModel = $derived<string>(active?.model ?? DEFAULT_MODEL)

  const makeChat = (t: Thread, initial: UIMessage[]) =>
    new Chat({
      messages: initial,
      transport: new DefaultChatTransport({
        api: "/api/chat",
        body: () => {
          // Read latest skills snapshot from the threads state at send-time,
          // not from the closure (so adds/removes mid-thread take effect).
          const live = threads.find((x) => x.id === t.id) ?? t
          return {
            model: live.model,
            sessionId: live.sandbox_session_id,
            skills: live.skills.map((s) => ({
              id: s.id,
              source: s.source,
              skillId: s.skillId,
              name: s.name,
              description: s.description,
            })),
          }
        },
      }),
      onError: (e) => toast.error(e.message),
    })

  const flushSave = () => {
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
    const updated = updateThread(id, { title, messages })
    if (!updated) return
    threads = threads
      .map((x) => (x.id === updated.id ? { ...x, title: updated.title, updated_at: updated.updated_at } : x))
      .sort((a, b) => b.updated_at - a.updated_at)
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

  const setActive = (t: Thread) => {
    if (activeId && activeId !== t.id) flushSave()
    activeId = t.id
    const full = getThread(t.id)
    chat = makeChat(t, full?.messages ?? [])
  }

  const startNew = () => {
    flushSave()
    const t = createThread(active?.model ?? DEFAULT_MODEL)
    threads = [t, ...threads.filter((x) => x.id !== t.id)]
    activeId = t.id
    chat = makeChat(t, t.messages)
  }

  const removeThread = (id: string) => {
    deleteThread(id)
    threads = threads.filter((t) => t.id !== id)
    if (activeId === id) {
      activeId = null
      chat = null
      if (threads.length > 0) setActive(threads[0]!)
      else startNew()
    }
  }

  const changeModel = (m: string) => {
    if (!active) return
    const updated = updateThread(active.id, { model: m })
    if (!updated) return
    threads = threads
      .map((t) => (t.id === updated.id ? { ...t, model: updated.model, updated_at: updated.updated_at } : t))
      .sort((a, b) => b.updated_at - a.updated_at)
    const t = threads.find((x) => x.id === updated.id)
    if (chat && t) chat = makeChat(t, chat.messages)
  }

  const addSkill = (skill: AttachedSkill) => {
    if (!active) return
    if (active.skills.some((s) => s.id === skill.id)) return
    const next = [...active.skills, skill]
    const updated = updateThread(active.id, { skills: next })
    if (!updated) return
    threads = threads.map((t) =>
      t.id === updated.id ? { ...t, skills: updated.skills, updated_at: updated.updated_at } : t,
    )
  }

  const removeSkill = (id: string) => {
    if (!active) return
    const next = active.skills.filter((s) => s.id !== id)
    const updated = updateThread(active.id, { skills: next })
    if (!updated) return
    threads = threads.map((t) =>
      t.id === updated.id ? { ...t, skills: updated.skills, updated_at: updated.updated_at } : t,
    )
  }

  onMount(() => {
    // Migrate any thread with a model that's no longer in MODELS to DEFAULT_MODEL.
    const initial = listThreads().map((t) =>
      isValidModel(t.model) ? t : { ...t, model: DEFAULT_MODEL },
    )
    threads = initial
    if (initial.length === 0) startNew()
    else setActive(initial[0]!)
  })

  // Persist messages on every change (debounced) and flush immediately when the stream completes.
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
      : (text ? `${text}\n\n` : "") +
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
        {#if active}
          <SkillsPicker skills={active.skills} onAdd={addSkill} onRemove={removeSkill} />
        {/if}
        <ModelPicker value={currentModel} onSelect={changeModel} />
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
                The agent has a Linux sandbox with python, node, and bash. Attach files to the
                composer and the agent can read them; it will attach its deliverables back to chat.
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
