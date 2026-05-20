import { Hono } from "hono"
import { zValidator } from "@hono/zod-validator"
import { z } from "zod"
import { and, desc, eq } from "drizzle-orm"
import { randomUUID } from "node:crypto"
import { db } from "../db"
import { thread } from "../db/schema"
import type { AuthVars } from "../middleware/require-auth"

const createBody = z.object({
  model: z.string().min(1),
  title: z.string().optional(),
  sandbox_session_id: z.string().optional(),
})

const updateBody = z.object({
  title: z.string().optional(),
  model: z.string().optional(),
  messages: z.array(z.any()).optional(),
})

const summarize = (row: typeof thread.$inferSelect) => ({
  id: row.id,
  title: row.title,
  sandbox_session_id: row.sandbox_session_id,
  model: row.model,
  created_at: row.created_at.getTime(),
  updated_at: row.updated_at.getTime(),
})

export const threads = new Hono<{ Variables: AuthVars }>()
  .get("/", async (c) => {
    const userId = c.var.user.id
    const rows = await db
      .select({
        id: thread.id,
        title: thread.title,
        sandbox_session_id: thread.sandbox_session_id,
        model: thread.model,
        created_at: thread.created_at,
        updated_at: thread.updated_at,
      })
      .from(thread)
      .where(eq(thread.user_id, userId))
      .orderBy(desc(thread.updated_at))
    return c.json({
      threads: rows.map((r) => ({
        ...r,
        created_at: r.created_at.getTime(),
        updated_at: r.updated_at.getTime(),
      })),
    })
  })
  .post("/", zValidator("json", createBody), async (c) => {
    const userId = c.var.user.id
    const input = c.req.valid("json")
    const id = randomUUID()
    const sandbox = input.sandbox_session_id ?? randomUUID()
    const [row] = await db
      .insert(thread)
      .values({
        id,
        user_id: userId,
        title: input.title ?? "New chat",
        sandbox_session_id: sandbox,
        model: input.model,
        messages: [],
      })
      .returning()
    if (!row) return c.json({ error: "insert failed" }, 500)
    return c.json({ thread: { ...summarize(row), messages: row.messages } })
  })
  .get("/:id", async (c) => {
    const userId = c.var.user.id
    const id = c.req.param("id")
    const [row] = await db
      .select()
      .from(thread)
      .where(and(eq(thread.id, id), eq(thread.user_id, userId)))
    if (!row) return c.json({ error: "not found" }, 404)
    return c.json({ thread: { ...summarize(row), messages: row.messages } })
  })
  .put("/:id", zValidator("json", updateBody), async (c) => {
    const userId = c.var.user.id
    const id = c.req.param("id")
    const input = c.req.valid("json")
    const patch: Partial<typeof thread.$inferInsert> = { updated_at: new Date() }
    if (input.title !== undefined) patch.title = input.title
    if (input.model !== undefined) patch.model = input.model
    if (input.messages !== undefined) patch.messages = input.messages
    const [row] = await db
      .update(thread)
      .set(patch)
      .where(and(eq(thread.id, id), eq(thread.user_id, userId)))
      .returning()
    if (!row) return c.json({ error: "not found" }, 404)
    return c.json({ thread: { ...summarize(row), messages: row.messages } })
  })
  .delete("/:id", async (c) => {
    const userId = c.var.user.id
    const id = c.req.param("id")
    const result = await db
      .delete(thread)
      .where(and(eq(thread.id, id), eq(thread.user_id, userId)))
      .returning({ id: thread.id })
    if (result.length === 0) return c.json({ error: "not found" }, 404)
    return c.json({ ok: true })
  })
