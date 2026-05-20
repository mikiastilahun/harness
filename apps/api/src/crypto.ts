// AES-256-GCM with a key deterministically derived from BETTER_AUTH_SECRET.
// Ciphertext is base64(iv || ciphertext+tag). 12-byte IV per NIST SP 800-38D.
// Uses globalThis.crypto (Node 22+ exposes the Web Crypto API globally).

const subtle = globalThis.crypto.subtle
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

let cachedKey: CryptoKey | null = null

const getKey = async (): Promise<CryptoKey> => {
  if (cachedKey) return cachedKey
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set")
  const hash = await subtle.digest("SHA-256", textEncoder.encode(secret))
  const key = await subtle.importKey("raw", hash, { name: "AES-GCM" }, false, ["encrypt", "decrypt"])
  cachedKey = key
  return key
}

export const encrypt = async (plaintext: string): Promise<string> => {
  const key = await getKey()
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(
    await subtle.encrypt({ name: "AES-GCM", iv }, key, textEncoder.encode(plaintext)),
  )
  const out = new Uint8Array(iv.length + ct.length)
  out.set(iv)
  out.set(ct, iv.length)
  return Buffer.from(out).toString("base64")
}

export const decrypt = async (data: string): Promise<string> => {
  const key = await getKey()
  const buf = new Uint8Array(Buffer.from(data, "base64"))
  if (buf.length < 13) throw new Error("ciphertext too short")
  const iv = buf.slice(0, 12)
  const ct = buf.slice(12)
  const pt = await subtle.decrypt({ name: "AES-GCM", iv }, key, ct)
  return textDecoder.decode(pt)
}
