import { proxyTo } from "$lib/proxy"
import type { RequestHandler } from "./$types"

const handle: RequestHandler = ({ request, params }) =>
  proxyTo(request, `/${params.path}`)

export const GET = handle
export const POST = handle
export const PUT = handle
export const PATCH = handle
export const DELETE = handle
export const OPTIONS = handle
