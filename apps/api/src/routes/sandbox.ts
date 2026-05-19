import { Hono } from "hono"
import { uploadFile, downloadFile } from "../sandbox/provider"

const MAX_BYTES = 25 * 1024 * 1024

export const sandbox = new Hono()
  .post("/upload", async (c) => {
    const form = await c.req.parseBody({ all: true })
    const sessionId = String(form.sessionId ?? "")
    if (!sessionId) return c.json({ error: "sessionId required" }, 400)
    const raw = form.file
    const files = Array.isArray(raw) ? raw : raw ? [raw] : []
    const inputs = files.filter((f): f is File => f instanceof File)
    if (inputs.length === 0) return c.json({ error: "at least one file required" }, 400)
    for (const f of inputs) {
      if (f.size > MAX_BYTES) return c.json({ error: `${f.name} exceeds ${MAX_BYTES} bytes` }, 413)
    }
    const results = []
    for (const f of inputs) {
      const bytes = new Uint8Array(await f.arrayBuffer())
      const r = await uploadFile(sessionId, f.name, bytes)
      results.push(r)
    }
    return c.json({ files: results })
  })
  .get("/file", async (c) => {
    const sessionId = c.req.query("sessionId")
    const path = c.req.query("path")
    if (!sessionId || !path) return c.json({ error: "sessionId and path required" }, 400)
    try {
      const r = await downloadFile(sessionId, path)
      return new Response(r.stream, {
        status: 200,
        headers: {
          "content-type": r.mime,
          "content-length": String(r.size),
          "content-disposition": `inline; filename="${r.name.replace(/"/g, "")}"`,
          "cache-control": "no-store",
        },
      })
    } catch (e) {
      return c.json({ error: (e as Error).message }, 404)
    }
  })
