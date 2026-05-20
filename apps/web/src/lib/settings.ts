import type { Provider } from "./models"

export type Settings = {
  provider: Provider | null
  has_google_key: boolean
  has_openai_key: boolean
  has_anthropic_key: boolean
  updated_at: number | null
}

const jsonHeaders = { "content-type": "application/json" }

const handle = async <T>(r: Response): Promise<T> => {
  if (!r.ok) {
    const text = await r.text().catch(() => "")
    throw new Error(text || `${r.status} ${r.statusText}`)
  }
  return (await r.json()) as T
}

export const getSettings = async (): Promise<Settings> => {
  const r = await fetch("/api/settings")
  const { settings } = await handle<{ settings: Settings }>(r)
  return settings
}

export const updateSettings = async (
  patch: Partial<{
    provider: Provider | null
    google_api_key: string | null
    openai_api_key: string | null
    anthropic_api_key: string | null
  }>,
): Promise<Settings> => {
  const r = await fetch("/api/settings", {
    method: "PUT",
    headers: jsonHeaders,
    body: JSON.stringify(patch),
  })
  const { settings } = await handle<{ settings: Settings }>(r)
  return settings
}

export const hasKeyFor = (s: Settings, p: Provider): boolean =>
  p === "google" ? s.has_google_key : p === "openai" ? s.has_openai_key : s.has_anthropic_key

export const isConfigured = (s: Settings): boolean =>
  s.provider !== null && hasKeyFor(s, s.provider)
