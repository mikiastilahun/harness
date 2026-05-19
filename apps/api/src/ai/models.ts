import { createVertex } from "@ai-sdk/google-vertex"

const project =
  process.env.GOOGLE_VERTEX_PROJECT ??
  process.env.GOOGLE_CLOUD_PROJECT ??
  process.env.GCP_PROJECT ??
  process.env.GCLOUD_PROJECT

const location =
  process.env.GOOGLE_VERTEX_LOCATION ?? process.env.GOOGLE_CLOUD_LOCATION ?? "global"

if (!project) {
  throw new Error("GOOGLE_VERTEX_PROJECT (or GOOGLE_CLOUD_PROJECT) is required")
}

const vertex = createVertex({ project, location })

export const models = {
  "gemini-3.1-pro-preview": vertex("gemini-3.1-pro-preview"),
  "gemini-3-flash-preview": vertex("gemini-3-flash-preview"),
  "gemini-3.1-flash-lite": vertex("gemini-3.1-flash-lite"),
  "gemini-2.5-pro": vertex("gemini-2.5-pro"),
  "gemini-2.5-flash": vertex("gemini-2.5-flash"),
} as const

export type ModelId = keyof typeof models

export const defaultModel: ModelId = "gemini-3.1-pro-preview"

export const modelMeta: Record<ModelId, { label: string; tier: "preview" | "ga"; speed: "fast" | "mid" | "deep" }> = {
  "gemini-3.1-pro-preview": { label: "Gemini 3.1 Pro", tier: "preview", speed: "deep" },
  "gemini-3-flash-preview": { label: "Gemini 3 Flash", tier: "preview", speed: "fast" },
  "gemini-3.1-flash-lite": { label: "Gemini 3.1 Flash Lite", tier: "ga", speed: "fast" },
  "gemini-2.5-pro": { label: "Gemini 2.5 Pro", tier: "ga", speed: "mid" },
  "gemini-2.5-flash": { label: "Gemini 2.5 Flash", tier: "ga", speed: "fast" },
}
