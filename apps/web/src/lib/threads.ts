import type { UIMessage } from "ai"

export type Thread = {
  id: string
  title: string
  sessionId: string
  model: string
  createdAt: number
  updatedAt: number
}

const INDEX_KEY = "harness.threads.v1"
const msgKey = (id: string) => `harness.thread.v1.${id}`

const safeParse = <T>(v: string | null, fallback: T): T => {
  if (!v) return fallback
  try {
    return JSON.parse(v) as T
  } catch {
    return fallback
  }
}

export const loadIndex = (): Thread[] => {
  if (typeof localStorage === "undefined") return []
  return safeParse<Thread[]>(localStorage.getItem(INDEX_KEY), [])
    .filter((t) => t && typeof t.id === "string")
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export const saveIndex = (threads: Thread[]) => {
  if (typeof localStorage === "undefined") return
  localStorage.setItem(INDEX_KEY, JSON.stringify(threads))
}

export const loadMessages = (id: string): UIMessage[] => {
  if (typeof localStorage === "undefined") return []
  return safeParse<UIMessage[]>(localStorage.getItem(msgKey(id)), [])
}

export const saveMessages = (id: string, messages: UIMessage[]) => {
  if (typeof localStorage === "undefined") return
  localStorage.setItem(msgKey(id), JSON.stringify(messages))
}

export const deleteThread = (id: string) => {
  if (typeof localStorage === "undefined") return
  localStorage.removeItem(msgKey(id))
  const idx = loadIndex().filter((t) => t.id !== id)
  saveIndex(idx)
}

export const upsertThread = (thread: Thread) => {
  const idx = loadIndex()
  const i = idx.findIndex((t) => t.id === thread.id)
  if (i === -1) idx.unshift(thread)
  else idx[i] = thread
  saveIndex(idx)
}

export const newThread = (model: string): Thread => {
  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    title: "New chat",
    sessionId: crypto.randomUUID(),
    model,
    createdAt: now,
    updatedAt: now,
  }
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
