<script lang="ts">
  import { Button } from "$lib/components/ui/button"
  import { Textarea } from "$lib/components/ui/textarea"
  import { toast } from "svelte-sonner"
  import ArrowUp from "@lucide/svelte/icons/arrow-up"
  import Paperclip from "@lucide/svelte/icons/paperclip"
  import X from "@lucide/svelte/icons/x"
  import FileIcon from "@lucide/svelte/icons/file"
  import Loader from "@lucide/svelte/icons/loader-circle"
  import { cn } from "$lib/utils"

  type Attachment = {
    id: string
    file: File
    status: "pending" | "uploading" | "uploaded" | "error"
    path?: string
    error?: string
  }

  type Props = {
    sessionId: string
    disabled?: boolean
    onSend: (text: string, attachedPaths: string[]) => void
  }

  let { sessionId, disabled = false, onSend }: Props = $props()

  let input = $state("")
  let attachments = $state<Attachment[]>([])
  let dragOver = $state(false)
  let fileInput: HTMLInputElement
  let uploading = $derived(attachments.some((a) => a.status === "uploading"))
  let canSend = $derived(!disabled && !uploading && (input.trim().length > 0 || attachments.length > 0))

  const MAX_BYTES = 25 * 1024 * 1024

  const formatBytes = (n: number) => {
    if (n < 1024) return `${n} B`
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
    return `${(n / 1024 / 1024).toFixed(2)} MB`
  }

  const addFiles = async (files: File[]) => {
    const accepted: Attachment[] = []
    for (const file of files) {
      if (file.size > MAX_BYTES) {
        toast.error(`${file.name} exceeds 25 MB`)
        continue
      }
      accepted.push({ id: crypto.randomUUID(), file, status: "pending" })
    }
    if (accepted.length === 0) return
    attachments = [...attachments, ...accepted]
    await Promise.all(accepted.map((a) => uploadOne(a)))
  }

  const uploadOne = async (a: Attachment) => {
    a.status = "uploading"
    attachments = attachments.map((x) => (x.id === a.id ? a : x))
    const form = new FormData()
    form.append("sessionId", sessionId)
    form.append("file", a.file, a.file.name)
    try {
      const r = await fetch("/api/sandbox/upload", { method: "POST", body: form })
      if (!r.ok) throw new Error(await r.text())
      const j = (await r.json()) as { files: { path: string; name: string; size: number }[] }
      const f = j.files[0]
      if (!f) throw new Error("upload returned no file")
      a.status = "uploaded"
      a.path = f.path
    } catch (e) {
      a.status = "error"
      a.error = (e as Error).message
      toast.error(`Upload failed: ${a.file.name}`)
    }
    attachments = attachments.map((x) => (x.id === a.id ? a : x))
  }

  const removeAttachment = (id: string) => {
    attachments = attachments.filter((a) => a.id !== id)
  }

  const submit = () => {
    if (!canSend) return
    const text = input.trim()
    const paths = attachments.filter((a) => a.status === "uploaded" && a.path).map((a) => a.path!)
    onSend(text, paths)
    input = ""
    attachments = []
  }

  const onKeydown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      submit()
      return
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  const onPick = (e: Event) => {
    const t = e.target as HTMLInputElement
    if (t.files && t.files.length > 0) addFiles(Array.from(t.files))
    t.value = ""
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    dragOver = false
    const files = e.dataTransfer?.files
    if (files && files.length > 0) addFiles(Array.from(files))
  }

  const onDragOver = (e: DragEvent) => {
    e.preventDefault()
    if (e.dataTransfer && Array.from(e.dataTransfer.items).some((i) => i.kind === "file")) {
      dragOver = true
    }
  }

  const onDragLeave = (e: DragEvent) => {
    if (e.currentTarget === e.target) dragOver = false
  }

  const onPaste = (e: ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    const pasted: File[] = []
    for (const it of items) {
      if (it.kind === "file") {
        const f = it.getAsFile()
        if (f) pasted.push(f)
      }
    }
    if (pasted.length > 0) {
      e.preventDefault()
      addFiles(pasted)
    }
  }
</script>

<form
  onsubmit={(e) => {
    e.preventDefault()
    submit()
  }}
  ondragover={onDragOver}
  ondragleave={onDragLeave}
  ondrop={onDrop}
  class={cn(
    "relative mx-auto flex max-w-3xl flex-col gap-2 rounded-xl border border-border bg-card/40 p-2 transition-colors",
    dragOver && "border-primary/60 bg-primary/5",
  )}
>
  {#if dragOver}
    <div
      class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-primary/60 bg-primary/5 text-sm text-primary"
    >
      Drop to attach
    </div>
  {/if}

  {#if attachments.length > 0}
    <div class="flex flex-wrap gap-1.5 px-1 pt-1">
      {#each attachments as a (a.id)}
        <div
          class="group flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs"
        >
          {#if a.status === "uploading"}
            <Loader class="size-3 animate-spin text-muted-foreground" />
          {:else if a.status === "error"}
            <FileIcon class="size-3 text-destructive" />
          {:else}
            <FileIcon class="size-3 text-muted-foreground" />
          {/if}
          <span class="max-w-[200px] truncate" title={a.file.name}>{a.file.name}</span>
          <span class="text-[10px] text-muted-foreground">{formatBytes(a.file.size)}</span>
          <button
            type="button"
            aria-label="Remove"
            class="ml-0.5 rounded p-0.5 opacity-60 hover:bg-muted hover:opacity-100"
            onclick={() => removeAttachment(a.id)}
          >
            <X class="size-3" />
          </button>
        </div>
      {/each}
    </div>
  {/if}

  <div class="flex items-end gap-2">
    <input bind:this={fileInput} type="file" multiple class="hidden" onchange={onPick} />
    <Button
      type="button"
      size="icon"
      variant="ghost"
      class="size-9 shrink-0"
      onclick={() => fileInput.click()}
      aria-label="Attach files"
    >
      <Paperclip />
    </Button>
    <Textarea
      bind:value={input}
      onkeydown={onKeydown}
      onpaste={onPaste}
      placeholder="Ask anything… (drop files to attach · Enter to send · Shift+Enter for newline)"
      rows={1}
      class="min-h-[40px] resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
    />
    <Button type="submit" size="icon" class="size-9 shrink-0" disabled={!canSend}>
      {#if uploading}<Loader class="animate-spin" />{:else}<ArrowUp />{/if}
    </Button>
  </div>
</form>
