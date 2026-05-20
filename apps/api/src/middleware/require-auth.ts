import { createMiddleware } from "hono/factory"
import { auth, type Session } from "../auth"

export type AuthVars = { session: Session["session"]; user: Session["user"] }

export const requireAuth = createMiddleware<{ Variables: AuthVars }>(async (c, next) => {
  const s = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!s) return c.json({ error: "unauthorized" }, 401)
  c.set("session", s.session)
  c.set("user", s.user)
  await next()
})
