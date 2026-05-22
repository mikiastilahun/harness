import { Hono } from "hono"
import { cors } from "hono/cors"
import { logger } from "hono/logger"
import { serve } from "@hono/node-server"
import { health } from "./routes/health"
import { chat } from "./routes/chat"
import { sandbox } from "./routes/sandbox"
import { skills } from "./routes/skills"

const webOrigin = process.env.WEB_URL ?? "http://localhost:5173"

const app = new Hono()
  .use("*", logger())
  .use(
    "*",
    cors({
      origin: webOrigin,
      allowHeaders: ["Content-Type"],
      allowMethods: ["GET", "POST", "OPTIONS"],
    }),
  )
  .route("/health", health)
  .route("/chat", chat)
  .route("/sandbox", sandbox)
  .route("/skills", skills)

const port = Number(process.env.API_PORT ?? 8787)

serve({ fetch: app.fetch, port })

console.log(`api listening on http://localhost:${port}`)
