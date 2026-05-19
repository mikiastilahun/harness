<script lang="ts">
  import { onMount, tick, untrack } from "svelte"
  import type { UIMessage } from "ai"
  import { Chat } from "@ai-sdk/svelte"
  import { DefaultChatTransport } from "ai"
  import { Badge } from "$lib/components/ui/badge"
  import { ScrollArea } from "$lib/components/ui/scroll-area"
  import * as Select from "$lib/components/ui/select"
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
  import {
    type Thread,
    loadIndex,
    loadMessages,
    saveMessages,
    deleteThread as deleteThreadStorage,
    upsertThread,
    newThread,
    titleFromMessages,
  } from "$lib/threads"

  type ModelId =
    | "gemini-3.1-pro-preview"
    | "gemini-3-flash-preview"
    | "gemini-3.1-flash-lite"
    | "gemini-2.5-pro"
    | "gemini-2.5-flash"

  const MODEL_OPTIONS: { value: ModelId; label: string; tier: "preview" | "ga" }[] = [
    { value: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", tier: "preview" },
    { value: "gemini-3-flash-preview", label: "Gemini 3 Flash", tier: "preview" },
    { value: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite", tier: "ga" },
    { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro", tier: "ga" },
    { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash", tier: "ga" },
  ]

  const DEFAULT_MODEL: ModelId = "gemini-3.1-pro-preview"

  let threads = $state<Thread[]>([])
  let activeId = $state<string | null>(null)
  let chat = $state<Chat | null>(null)
  let viewportRef = $state<HTMLElement | null>(null)

  const active = $derived(threads.find((t) => t.id === activeId) ?? null)
  const isBusy = $derived(chat?.status === "submitted" || chat?.status === "streaming")
  const currentModel = $derived<ModelId>((active?.model as ModelId) ?? DEFAULT_MODEL)
  const currentModelLabel = $derived(
    MODEL_OPTIONS.find((o) => o.value === currentModel)?.label ?? currentModel,
  )

  const makeChat = (t: Thread, initial: UIMessage[]) =>
    new Chat({
      messages: initial,
      transport: new DefaultChatTransport({
        api: "/api/chat",
        body: () => ({ model: t.model, sessionId: t.sessionId }),
      }),
      onError: (e) => toast.error(e.message),
    })

  const setActive = (t: Thread) => {
    activeId = t.id
    chat = makeChat(t, loadMessages(t.id))
  }

  const startNew = () => {
    const t = newThread(DEFAULT_MODEL)
    upsertThread(t)
    threads = [t, ...threads]
    setActive(t)
  }

  const removeThread = (id: string) => {
    deleteThreadStorage(id)
    threads = threads.filter((t) => t.id !== id)
    if (activeId === id) {
      if (threads.length > 0) setActive(threads[0]!)
      else startNew()
    }
  }

  const changeModel = (m: ModelId) => {
    if (!active) return
    const updated: Thread = { ...active, model: m, updatedAt: Date.now() }
    upsertThread(updated)
    threads = threads.map((t) => (t.id === updated.id ? updated : t)).sort((a, b) => b.updatedAt - a.updatedAt)
    if (chat) chat = makeChat(updated, chat.messages)
  }

  onMount(() => {
    threads = loadIndex()
    if (threads.length === 0) startNew()
    else setActive(threads[0]!)
  })

  $effect(() => {
    const c = chat
    if (!c || !activeId) return
    const msgs = c.messages
    untrack(() => {
      saveMessages(activeId!, msgs)
      const i = threads.findIndex((t) => t.id === activeId)
      if (i === -1) return
      const t = threads[i]!
      const title = titleFromMessages(msgs) ?? t.title
      if (title !== t.title || msgs.length > 0) {
        const updated: Thread = { ...t, title, updatedAt: Date.now() }
        upsertThread(updated)
        const rest = threads.filter((x) => x.id !== updated.id)
        threads = [updated, ...rest].sort((a, b) => b.updatedAt - a.updatedAt)
      }
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

<div class="flex h-full">
  <Sidebar {threads} {activeId} onSelect={setActive} onNew={startNew} onDelete={removeThread} />

  <main class="flex min-w-0 flex-1 flex-col">
    <header class="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
      <div class="flex min-w-0 items-center gap-2">
        <div class="truncate text-sm font-medium">{active?.title ?? "harness"}</div>
        {#if active}
          <Badge variant="outline" class="hidden font-mono text-[10px] sm:inline-flex">
            sb:{active.sessionId.slice(0, 8)}
          </Badge>
        {/if}
      </div>
      <Select.Root
        type="single"
        bind:value={() => currentModel, (v) => changeModel(v as ModelId)}
      >
        <Select.Trigger size="sm" class="w-[200px]">{currentModelLabel}</Select.Trigger>
        <Select.Content>
          {#each MODEL_OPTIONS as opt (opt.value)}
            <Select.Item value={opt.value}>
              <div class="flex w-full items-center justify-between gap-3">
                <span>{opt.label}</span>
                <span class="text-[10px] text-muted-foreground">{opt.tier}</span>
              </div>
            </Select.Item>
          {/each}
        </Select.Content>
      </Select.Root>
    </header>

    <ScrollArea class="flex-1" bind:viewportRef>
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
        {/if}
      </div>
    </ScrollArea>

    <div class="border-t border-border bg-background px-4 py-3 sm:px-6">
      {#if active}
        <Composer sessionId={active.sessionId} disabled={isBusy} onSend={sendWithFiles} />
      {/if}
      <div class="mx-auto mt-2 max-w-3xl text-center text-[10px] text-muted-foreground">
        <span class="font-mono"
          >bash · python · read · write · edit · list · search · fetch · pip · apt · attach</span
        >
        <span class="opacity-60"> · up to 20 steps per turn</span>
      </div>
    </div>
  </main>
</div>
