import { createAuthClient } from "better-auth/svelte"
import { env } from "$env/dynamic/public"

const base = env.PUBLIC_BASE_URL ?? "http://localhost:5173"

export const authClient = createAuthClient({
  baseURL: `${base}/api/auth`,
})

export const { signIn, signOut, useSession } = authClient
