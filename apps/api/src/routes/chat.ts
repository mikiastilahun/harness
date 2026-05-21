import { Hono } from "hono"
import { zValidator } from "@hono/zod-validator"
import { z } from "zod"
import { streamText, convertToModelMessages, stepCountIs, type UIMessage } from "ai"
import { isValidModel, DEFAULT_MODEL } from "@harness/shared"
import { buildModel } from "../ai/models"
import { baseSystemPrompt } from "../ai/system-prompt"
import { sandboxTools } from "../ai/tools"

const body = z.object({
  messages: z.array(z.any()),
  model: z.string().optional(),
  sessionId: z.string().optional(),
})

export const chat = new Hono().post("/", zValidator("json", body), async (c) => {
  const input = c.req.valid("json")
  const modelId = input.model && isValidModel(input.model) ? input.model : DEFAULT_MODEL
  const sessionId = input.sessionId ?? "default"
  const result = streamText({
    model: buildModel(modelId),
    system: baseSystemPrompt,
    messages: await convertToModelMessages(input.messages as UIMessage[]),
    tools: sandboxTools(sessionId),
    stopWhen: stepCountIs(20),
  })
  return result.toUIMessageStreamResponse()
})
