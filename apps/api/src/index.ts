import { Hono } from "hono"
import { cors } from "hono/cors"
import { logger } from "hono/logger"
import { health } from "./routes/health"
import { chat } from "./routes/chat"
import { sandbox } from "./routes/sandbox"

const app = new Hono()
  .use("*", logger())
  .use("*", cors({ origin: (origin) => origin ?? "*", credentials: true }))
  .route("/health", health)
  .route("/chat", chat)
  .route("/sandbox", sandbox)

const port = Number(process.env.API_PORT ?? 8787)

Bun.serve({ port, fetch: app.fetch, idleTimeout: 0 })

console.log(`api listening on http://localhost:${port}`)
