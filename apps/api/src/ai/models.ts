import { createOpenAI } from "@ai-sdk/openai"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import type { LanguageModel } from "ai"
import type { Provider } from "@harness/shared"

export const buildModel = (provider: Provider, modelId: string, apiKey: string): LanguageModel => {
  if (provider === "google") return createGoogleGenerativeAI({ apiKey })(modelId)
  if (provider === "openai") return createOpenAI({ apiKey })(modelId)
  return createAnthropic({ apiKey })(modelId)
}
