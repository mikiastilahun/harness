export type Provider = "google" | "openai" | "anthropic"

export type ModelInfo = {
  id: string
  label: string
  speed: "fast" | "mid" | "deep"
}

export const PROVIDERS: readonly Provider[] = ["google", "openai", "anthropic"] as const

export const PROVIDER_LABELS: Record<Provider, string> = {
  google: "Google Gemini",
  openai: "OpenAI",
  anthropic: "Anthropic",
}

export const PROVIDER_KEY_LABEL: Record<Provider, string> = {
  google: "Gemini API key",
  openai: "OpenAI API key",
  anthropic: "Anthropic API key",
}

export const PROVIDER_KEY_HINT: Record<Provider, string> = {
  google: "Create at https://aistudio.google.com/apikey",
  openai: "Create at https://platform.openai.com/api-keys",
  anthropic: "Create at https://console.anthropic.com/settings/keys",
}

export const PROVIDER_MODELS: Record<Provider, ModelInfo[]> = {
  google: [
    { id: "gemini-3-pro-preview", label: "Gemini 3 Pro (preview)", speed: "deep" },
    { id: "gemini-3-flash-preview", label: "Gemini 3 Flash (preview)", speed: "mid" },
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", speed: "deep" },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", speed: "mid" },
    { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite", speed: "fast" },
    { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", speed: "mid" },
    { id: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite", speed: "fast" },
    { id: "gemini-1.5-pro", label: "Gemini 1.5 Pro", speed: "deep" },
    { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash", speed: "mid" },
    { id: "gemini-1.5-flash-8b", label: "Gemini 1.5 Flash 8B", speed: "fast" },
  ],
  openai: [
    { id: "gpt-5", label: "GPT-5", speed: "deep" },
    { id: "gpt-5-mini", label: "GPT-5 mini", speed: "mid" },
    { id: "gpt-5-nano", label: "GPT-5 nano", speed: "fast" },
    { id: "gpt-4.1", label: "GPT-4.1", speed: "deep" },
    { id: "gpt-4.1-mini", label: "GPT-4.1 mini", speed: "mid" },
    { id: "gpt-4.1-nano", label: "GPT-4.1 nano", speed: "fast" },
    { id: "gpt-4o", label: "GPT-4o", speed: "mid" },
    { id: "gpt-4o-mini", label: "GPT-4o mini", speed: "fast" },
    { id: "o3", label: "o3", speed: "deep" },
    { id: "o3-mini", label: "o3-mini", speed: "mid" },
    { id: "o4-mini", label: "o4-mini", speed: "mid" },
    { id: "o1", label: "o1", speed: "deep" },
    { id: "o1-mini", label: "o1-mini", speed: "mid" },
  ],
  anthropic: [
    { id: "claude-opus-4-7", label: "Claude Opus 4.7", speed: "deep" },
    { id: "claude-opus-4-6", label: "Claude Opus 4.6", speed: "deep" },
    { id: "claude-opus-4-5", label: "Claude Opus 4.5", speed: "deep" },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", speed: "mid" },
    { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", speed: "mid" },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", speed: "fast" },
    { id: "claude-3-7-sonnet-latest", label: "Claude 3.7 Sonnet", speed: "mid" },
    { id: "claude-3-5-sonnet-latest", label: "Claude 3.5 Sonnet", speed: "mid" },
    { id: "claude-3-5-haiku-latest", label: "Claude 3.5 Haiku", speed: "fast" },
    { id: "claude-3-opus-latest", label: "Claude 3 Opus", speed: "deep" },
  ],
}

export const isProvider = (v: unknown): v is Provider =>
  typeof v === "string" && (PROVIDERS as readonly string[]).includes(v)

export const defaultModelFor = (provider: Provider): string =>
  `${provider}:${PROVIDER_MODELS[provider][0]!.id}`

export const parseModel = (full: string): { provider: Provider; model: string } | null => {
  const i = full.indexOf(":")
  if (i === -1) return null
  const p = full.slice(0, i)
  const m = full.slice(i + 1)
  if (!isProvider(p) || m.length === 0) return null
  return { provider: p, model: m }
}

export const modelLabel = (full: string): string => {
  const parsed = parseModel(full)
  if (!parsed) return full
  const info = PROVIDER_MODELS[parsed.provider].find((m) => m.id === parsed.model)
  return info?.label ?? parsed.model
}
