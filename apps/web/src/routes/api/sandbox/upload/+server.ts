import { env } from "$env/dynamic/private"
import type { RequestHandler } from "./$types"

const API_URL = env.API_URL ?? "http://localhost:8787"

export const POST: RequestHandler = async ({ request }) => {
  const upstream = await fetch(`${API_URL}/sandbox/upload`, {
    method: "POST",
    headers: {
      "content-type": request.headers.get("content-type") ?? "application/octet-stream",
    },
    body: request.body,
    // @ts-expect-error duplex required for streaming request bodies in undici/node
    duplex: "half",
  })
  return new Response(upstream.body, {
    status: upstream.status,
    headers: upstream.headers,
  })
}
