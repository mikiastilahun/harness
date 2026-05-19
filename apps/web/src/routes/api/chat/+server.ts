import { env } from "$env/dynamic/private"
import type { RequestHandler } from "./$types"

const API_URL = env.API_URL ?? "http://localhost:8787"

export const POST: RequestHandler = async ({ request }) => {
  const upstream = await fetch(`${API_URL}/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: request.body,
    // @ts-expect-error duplex required for streaming request bodies
    duplex: "half",
  })
  return new Response(upstream.body, {
    status: upstream.status,
    headers: upstream.headers,
  })
}
