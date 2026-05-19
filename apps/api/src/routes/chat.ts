import { Hono } from "hono"
import { zValidator } from "@hono/zod-validator"
import { z } from "zod"
import { streamText, convertToModelMessages, stepCountIs, type UIMessage } from "ai"
import { models, defaultModel, type ModelId } from "../ai/models"
import { baseSystemPrompt } from "../ai/system-prompt"
import { sandboxTools } from "../ai/tools"

const body = z.object({
  messages: z.array(z.any()),
  model: z.string().optional(),
  sessionId: z.string().optional(),
})

export const chat = new Hono().post("/", zValidator("json", body), async (c) => {
  const input = c.req.valid("json")
  const id = (input.model ?? defaultModel) as ModelId
  const model = models[id] ?? models[defaultModel]
  const sessionId = input.sessionId ?? "default"
  const result = streamText({
    model,
    system: baseSystemPrompt,
    messages: await convertToModelMessages(input.messages as UIMessage[]),
    tools: sandboxTools(sessionId),
    stopWhen: stepCountIs(20),
  })
  return result.toUIMessageStreamResponse()
})
