export type ModelInfo = {
  id: string
  label: string
  speed: "fast" | "mid" | "deep"
}

// Vertex AI Gemini models. Authentication is via gcloud Application Default
// Credentials (`gcloud auth application-default login`) — no API key.
//
// Gemini 3.x preview models require GOOGLE_VERTEX_LOCATION=global in .env.
export const MODELS: ModelInfo[] = [
  { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (preview)", speed: "deep" },
  { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite", speed: "fast" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", speed: "deep" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", speed: "mid" },
  { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite", speed: "fast" },
]

export const DEFAULT_MODEL: string = "gemini-3.1-pro-preview"

export const isValidModel = (id: string): boolean => MODELS.some((m) => m.id === id)

export const modelLabel = (id: string): string =>
  MODELS.find((m) => m.id === id)?.label ?? id
