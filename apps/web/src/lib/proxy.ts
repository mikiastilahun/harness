import { env } from "$env/dynamic/private"

const API_URL = env.API_URL ?? "http://localhost:8787"

const HOP_BY_HOP = new Set([
  "host",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "content-length",
])

const buildHeaders = (incoming: Headers): Headers => {
  const out = new Headers()
  incoming.forEach((value, key) => {
    if (HOP_BY_HOP.has(key.toLowerCase())) return
    out.set(key, value)
  })
  return out
}

const forwardResponse = (upstream: Response): Response => {
  const headers = new Headers()
  upstream.headers.forEach((value, key) => {
    if (HOP_BY_HOP.has(key.toLowerCase())) return
    if (key.toLowerCase() === "set-cookie") return
    headers.set(key, value)
  })
  for (const cookie of upstream.headers.getSetCookie()) {
    headers.append("set-cookie", cookie)
  }
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  })
}

export const proxyTo = async (request: Request, upstreamPath: string): Promise<Response> => {
  const incoming = new URL(request.url)
  const target = `${API_URL}${upstreamPath}${incoming.search}`
  const method = request.method
  const init: RequestInit & { duplex?: "half" } = {
    method,
    headers: buildHeaders(request.headers),
    redirect: "manual",
  }
  if (method !== "GET" && method !== "HEAD") {
    init.body = request.body
    init.duplex = "half"
  }
  const upstream = await fetch(target, init)
  return forwardResponse(upstream)
}
