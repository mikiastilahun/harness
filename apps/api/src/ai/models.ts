import { vertex } from "@ai-sdk/google-vertex"
import type { LanguageModel } from "ai"

// Vertex AI authenticates via gcloud Application Default Credentials. Set
// GOOGLE_VERTEX_PROJECT and GOOGLE_VERTEX_LOCATION in the environment; run
// `gcloud auth application-default login` once on the host.
export const buildModel = (modelId: string): LanguageModel => vertex(modelId)
