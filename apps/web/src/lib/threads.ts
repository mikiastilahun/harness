import type { UIMessage } from "ai"

export type Thread = {
  id: string
  title: string
  sandbox_session_id: string
  model: string
  created_at: number
  updated_at: number
}

export type ThreadWithMessages = Thread & { messages: UIMessage[] }

// localStorage layout:
//   harness.threads          → JSON array of Thread (no messages)
//   harness.thread.<id>      → JSON ThreadWithMessages (full record)

const INDEX_KEY = "harness.threads"
const threadKey = (id: string) => `harness.thread.${id}`

const safeParse = <T>(raw: string | null): T | null => {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

const writeIndex = (threads: Thread[]) => {
  localStorage.setItem(INDEX_KEY, JSON.stringify(threads))
}

const writeFull = (full: ThreadWithMessages) => {
  localStorage.setItem(threadKey(full.id), JSON.stringify(full))
}

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36)

const summarize = (full: ThreadWithMessages): Thread => ({
  id: full.id,
  title: full.title,
  sandbox_session_id: full.sandbox_session_id,
  model: full.model,
  created_at: full.created_at,
  updated_at: full.updated_at,
})

export const listThreads = (): Thread[] => {
  const arr = safeParse<Thread[]>(localStorage.getItem(INDEX_KEY)) ?? []
  return [...arr].sort((a, b) => b.updated_at - a.updated_at)
}

export const createThread = (model: string): ThreadWithMessages => {
  const now = Date.now()
  const full: ThreadWithMessages = {
    id: newId(),
    title: "New chat",
    sandbox_session_id: newId(),
    model,
    created_at: now,
    updated_at: now,
    messages: [],
  }
  const index = listThreads()
  writeIndex([summarize(full), ...index])
  writeFull(full)
  return full
}

export const getThread = (id: string): ThreadWithMessages | null =>
  safeParse<ThreadWithMessages>(localStorage.getItem(threadKey(id)))

export const updateThread = (
  id: string,
  patch: { title?: string; model?: string; messages?: UIMessage[] },
): ThreadWithMessages | null => {
  const current = getThread(id)
  if (!current) return null
  const next: ThreadWithMessages = {
    ...current,
    title: patch.title ?? current.title,
    model: patch.model ?? current.model,
    messages: patch.messages ?? current.messages,
    updated_at: Date.now(),
  }
  writeFull(next)
  const index = listThreads().map((t) => (t.id === id ? summarize(next) : t))
  writeIndex(index)
  return next
}

export const deleteThread = (id: string) => {
  localStorage.removeItem(threadKey(id))
  const index = listThreads().filter((t) => t.id !== id)
  writeIndex(index)
}

export const titleFromMessages = (messages: UIMessage[]): string | null => {
  const first = messages.find((m) => m.role === "user")
  if (!first) return null
  const text = first.parts
    .map((p) => (p.type === "text" ? p.text : ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
  if (!text) return null
  return text.length > 60 ? text.slice(0, 57) + "…" : text
}

export const formatTime = (ts: number) => {
  const d = new Date(ts)
  const now = new Date()
  const diff = (now.getTime() - ts) / 1000
  if (diff < 60) return "just now"
  if (diff < 3600) return Math.floor(diff / 60) + "m"
  if (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  )
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  if (diff < 86400 * 7) return d.toLocaleDateString(undefined, { weekday: "short" })
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}
