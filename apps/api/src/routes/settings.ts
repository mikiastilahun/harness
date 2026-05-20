import { Hono } from "hono"
import { zValidator } from "@hono/zod-validator"
import { z } from "zod"
import { eq } from "drizzle-orm"
import { db } from "../db"
import { user_settings } from "../db/schema"
import { encrypt } from "../crypto"
import { PROVIDERS, type Provider } from "@harness/shared"
import type { AuthVars } from "../middleware/require-auth"

const providerEnum = z.enum(PROVIDERS as readonly [Provider, ...Provider[]])

const updateBody = z
  .object({
    provider: providerEnum.nullable().optional(),
    google_api_key: z.string().min(1).nullable().optional(),
    openai_api_key: z.string().min(1).nullable().optional(),
    anthropic_api_key: z.string().min(1).nullable().optional(),
  })
  .strict()

const summarize = (row: typeof user_settings.$inferSelect | undefined) => ({
  provider: row?.provider ?? null,
  has_google_key: !!row?.google_api_key,
  has_openai_key: !!row?.openai_api_key,
  has_anthropic_key: !!row?.anthropic_api_key,
  updated_at: row?.updated_at?.getTime() ?? null,
})

export const settings = new Hono<{ Variables: AuthVars }>()
  .get("/", async (c) => {
    const userId = c.var.user.id
    const [row] = await db.select().from(user_settings).where(eq(user_settings.user_id, userId))
    return c.json({ settings: summarize(row) })
  })
  .put("/", zValidator("json", updateBody), async (c) => {
    const userId = c.var.user.id
    const input = c.req.valid("json")
    const patch: Partial<typeof user_settings.$inferInsert> = { updated_at: new Date() }
    if (input.provider !== undefined) patch.provider = input.provider
    if (input.google_api_key !== undefined) {
      patch.google_api_key = input.google_api_key === null ? null : await encrypt(input.google_api_key)
    }
    if (input.openai_api_key !== undefined) {
      patch.openai_api_key = input.openai_api_key === null ? null : await encrypt(input.openai_api_key)
    }
    if (input.anthropic_api_key !== undefined) {
      patch.anthropic_api_key =
        input.anthropic_api_key === null ? null : await encrypt(input.anthropic_api_key)
    }
    const [existing] = await db
      .select({ user_id: user_settings.user_id })
      .from(user_settings)
      .where(eq(user_settings.user_id, userId))
    if (existing) {
      const [row] = await db
        .update(user_settings)
        .set(patch)
        .where(eq(user_settings.user_id, userId))
        .returning()
      return c.json({ settings: summarize(row) })
    }
    const [row] = await db
      .insert(user_settings)
      .values({ user_id: userId, ...patch })
      .returning()
    return c.json({ settings: summarize(row) })
  })
