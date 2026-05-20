import { Hono } from "hono"
import { zValidator } from "@hono/zod-validator"
import { z } from "zod"
import { eq } from "drizzle-orm"
import { streamText, convertToModelMessages, stepCountIs, type UIMessage } from "ai"
import { db } from "../db"
import { user_settings } from "../db/schema"
import { decrypt } from "../crypto"
import { parseModel, type Provider } from "@harness/shared"
import { buildModel } from "../ai/models"
import { baseSystemPrompt } from "../ai/system-prompt"
import { sandboxTools } from "../ai/tools"
import type { AuthVars } from "../middleware/require-auth"

const body = z.object({
  messages: z.array(z.any()),
  model: z.string(),
  sessionId: z.string().optional(),
})

type KeyField = "google_api_key" | "openai_api_key" | "anthropic_api_key"

const keyFieldFor = (p: Provider): KeyField =>
  p === "google" ? "google_api_key" : p === "openai" ? "openai_api_key" : "anthropic_api_key"

export const chat = new Hono<{ Variables: AuthVars }>().post(
  "/",
  zValidator("json", body),
  async (c) => {
    const userId = c.var.user.id
    const input = c.req.valid("json")
    const parsed = parseModel(input.model)
    if (!parsed) return c.json({ error: "invalid model" }, 400)

    const [row] = await db
      .select()
      .from(user_settings)
      .where(eq(user_settings.user_id, userId))
    const encryptedKey = row?.[keyFieldFor(parsed.provider)]
    if (!encryptedKey) {
      return c.json(
        { error: `no API key configured for provider "${parsed.provider}"` },
        412,
      )
    }
    const apiKey = await decrypt(encryptedKey)
    const model = buildModel(parsed.provider, parsed.model, apiKey)

    const sessionId = input.sessionId ?? "default"
    const result = streamText({
      model,
      system: baseSystemPrompt,
      messages: await convertToModelMessages(input.messages as UIMessage[]),
      tools: sandboxTools(sessionId),
      stopWhen: stepCountIs(20),
    })
    return result.toUIMessageStreamResponse()
  },
)
