import { env } from "$env/dynamic/private"
import type { RequestHandler } from "./$types"

const API_URL = env.API_URL ?? "http://localhost:8787"

export const GET: RequestHandler = async ({ url }) => {
  const target = new URL("/sandbox/file", API_URL)
  target.search = url.search
  const upstream = await fetch(target, { method: "GET" })
  return new Response(upstream.body, {
    status: upstream.status,
    headers: upstream.headers,
  })
}
