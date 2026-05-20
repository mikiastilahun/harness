import { Hono } from "hono"
import { cors } from "hono/cors"
import { logger } from "hono/logger"
import { serve } from "@hono/node-server"
import { auth } from "./auth"
import { requireAuth } from "./middleware/require-auth"
import { health } from "./routes/health"
import { chat } from "./routes/chat"
import { sandbox } from "./routes/sandbox"
import { threads } from "./routes/threads"
import { settings } from "./routes/settings"

const webOrigin = process.env.WEB_URL ?? "http://localhost:5173"

const app = new Hono()
  .use("*", logger())
  .use(
    "*",
    cors({
      origin: webOrigin,
      credentials: true,
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    }),
  )
  .all("/api/auth/*", (c) => auth.handler(c.req.raw))
  .route("/health", health)
  .use("/chat/*", requireAuth)
  .route("/chat", chat)
  .use("/sandbox/*", requireAuth)
  .route("/sandbox", sandbox)
  .use("/threads/*", requireAuth)
  .route("/threads", threads)
  .use("/settings/*", requireAuth)
  .route("/settings", settings)

const port = Number(process.env.API_PORT ?? 8787)

serve({ fetch: app.fetch, port })

console.log(`api listening on http://localhost:${port}`)
