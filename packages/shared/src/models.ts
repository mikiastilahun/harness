export type ModelInfo = {
  id: string
  label: string
  speed: "fast" | "mid" | "deep"
}

// Vertex AI Gemini models. Authentication is via gcloud Application Default
// Credentials (`gcloud auth application-default login`) — no API key.
export const MODELS: ModelInfo[] = [
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", speed: "deep" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", speed: "mid" },
  { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite", speed: "fast" },
]

export const DEFAULT_MODEL: string = "gemini-2.5-flash"

export const isValidModel = (id: string): boolean => MODELS.some((m) => m.id === id)

export const modelLabel = (id: string): string =>
  MODELS.find((m) => m.id === id)?.label ?? id
