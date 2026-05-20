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

const jsonHeaders = { "content-type": "application/json" }

const handle = async <T>(r: Response): Promise<T> => {
  if (!r.ok) {
    const text = await r.text().catch(() => "")
    throw new Error(text || `${r.status} ${r.statusText}`)
  }
  return (await r.json()) as T
}

export const listThreads = async (): Promise<Thread[]> => {
  const r = await fetch("/api/threads")
  const { threads } = await handle<{ threads: Thread[] }>(r)
  return threads
}

export const createThread = async (model: string): Promise<ThreadWithMessages> => {
  const r = await fetch("/api/threads", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ model }),
  })
  const { thread } = await handle<{ thread: ThreadWithMessages }>(r)
  return thread
}

export const getThread = async (id: string): Promise<ThreadWithMessages> => {
  const r = await fetch(`/api/threads/${id}`)
  const { thread } = await handle<{ thread: ThreadWithMessages }>(r)
  return thread
}

export const updateThread = async (
  id: string,
  patch: { title?: string; model?: string; messages?: UIMessage[] },
): Promise<ThreadWithMessages> => {
  const r = await fetch(`/api/threads/${id}`, {
    method: "PUT",
    headers: jsonHeaders,
    body: JSON.stringify(patch),
  })
  const { thread } = await handle<{ thread: ThreadWithMessages }>(r)
  return thread
}

export const deleteThread = async (id: string): Promise<void> => {
  const r = await fetch(`/api/threads/${id}`, { method: "DELETE" })
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
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
