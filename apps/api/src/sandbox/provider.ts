import { randomUUID } from "node:crypto"
import { unlink, mkdtemp } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { guessMime, isTextLike, isImage } from "./mime"

const NS = process.env.KATA_NAMESPACE ?? "harness-sandboxes"
const CONTEXT = process.env.KATA_CONTEXT ?? "colima-harness"
const RUNTIME_CLASS = process.env.KATA_RUNTIME_CLASS ?? "kata-clh"
const IMAGE = process.env.SANDBOX_IMAGE ?? "harness-sandbox:1"
const IMAGE_PULL_POLICY = process.env.SANDBOX_IMAGE_PULL_POLICY ?? "IfNotPresent"
const CONTAINER = "shell"
const KUBECTL = process.env.KUBECTL ?? "kubectl"

const ready = new Map<string, Promise<void>>()

const podName = (sessionId: string) =>
  "harness-sb-" + sessionId.replace(/[^a-z0-9-]/gi, "").toLowerCase().slice(0, 40)

const kctl = async (
  args: string[],
  opts: { stdin?: string; timeoutMs?: number } = {},
): Promise<{ stdout: string; stderr: string; exit: number }> => {
  const proc = Bun.spawn([KUBECTL, "--context", CONTEXT, ...args], {
    stdin: opts.stdin ? new TextEncoder().encode(opts.stdin) : "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const timer = opts.timeoutMs ? setTimeout(() => proc.kill(), opts.timeoutMs) : null
  const [stdout, stderr, exit] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (timer) clearTimeout(timer)
  return { stdout, stderr, exit }
}

const podSpec = (sessionId: string) =>
  JSON.stringify({
    apiVersion: "v1",
    kind: "Pod",
    metadata: {
      name: podName(sessionId),
      namespace: NS,
      labels: { "app.kubernetes.io/name": "harness-sandbox", "harness.io/session": sessionId },
    },
    spec: {
      runtimeClassName: RUNTIME_CLASS,
      restartPolicy: "Never",
      terminationGracePeriodSeconds: 5,
      containers: [
        {
          name: CONTAINER,
          image: IMAGE,
          imagePullPolicy: IMAGE_PULL_POLICY,
          command: ["/bin/sh", "-c", "sleep infinity"],
          workingDir: "/workspace",
          resources: {
            limits: { cpu: "2", memory: "2Gi" },
            requests: { cpu: "200m", memory: "512Mi" },
          },
        },
      ],
    },
  })

const ensureNamespace = async () => {
  const r = await kctl(["get", "namespace", NS, "-o", "name"])
  if (r.exit === 0) return
  const c = await kctl(["create", "namespace", NS])
  if (c.exit !== 0 && !c.stderr.includes("already exists")) throw new Error(`create ns: ${c.stderr}`)
}

const ensurePod = async (sessionId: string) => {
  const name = podName(sessionId)
  const got = await kctl(["-n", NS, "get", "pod", name, "-o", "jsonpath={.status.phase}"])
  if (got.exit === 0 && got.stdout === "Running") return
  if (got.exit !== 0) {
    const apply = await kctl(["apply", "-f", "-"], { stdin: podSpec(sessionId) })
    if (apply.exit !== 0) throw new Error(`apply pod: ${apply.stderr}`)
  }
  const wait = await kctl(["-n", NS, "wait", `--for=condition=Ready`, `pod/${name}`, "--timeout=90s"])
  if (wait.exit !== 0) throw new Error(`wait pod: ${wait.stderr || wait.stdout}`)
}

const acquire = async (sessionId: string) => {
  const existing = ready.get(sessionId)
  if (existing) return existing
  const p = (async () => {
    await ensureNamespace()
    await ensurePod(sessionId)
  })()
  ready.set(sessionId, p)
  try {
    await p
  } catch (e) {
    ready.delete(sessionId)
    throw e
  }
}

type ExecResult = { stdout: string; stderr: string; exit: number; truncated: boolean }

const MAX_BYTES = 256 * 1024

const truncate = (s: string) =>
  s.length > MAX_BYTES ? { text: s.slice(0, MAX_BYTES) + "\n[truncated]", truncated: true } : { text: s, truncated: false }

const rawExec = async (
  sessionId: string,
  command: string[],
  stdin?: string,
  timeoutMs?: number,
) => {
  await acquire(sessionId)
  const args = ["-n", NS, "exec", podName(sessionId), "-c", CONTAINER]
  if (stdin !== undefined) args.push("-i")
  args.push("--", ...command)
  return kctl(args, { stdin, timeoutMs })
}

export const bash = async (sessionId: string, command: string, timeout = 60): Promise<ExecResult> => {
  const tag = randomUUID()
  const wrapped = `set +e\n{ ${command}\n} 2>&1\nrc=$?\necho "::EXIT_${tag}::$rc::"\nexit 0`
  const result = await rawExec(
    sessionId,
    ["/bin/bash", "-lc", `timeout ${timeout} bash -c ${shellQuote(wrapped)}`],
    undefined,
    (timeout + 10) * 1000,
  )
  const combined = result.stdout
  const m = combined.match(new RegExp(`::EXIT_${tag}::(-?\\d+)::`))
  const exit = m ? Number(m[1]) : result.exit
  const cleaned = m ? combined.replace(m[0], "").replace(/\s+$/, "") : combined
  const t = truncate(cleaned)
  return { stdout: t.text, stderr: result.stderr, exit, truncated: t.truncated }
}

export const readFile = async (sessionId: string, path: string) => {
  const r = await rawExec(sessionId, ["/bin/cat", path])
  return truncate(r.stdout).text
}

export const writeFile = async (sessionId: string, path: string, content: string) => {
  const r = await rawExec(
    sessionId,
    ["/bin/sh", "-c", `mkdir -p "$(dirname ${shellQuote(path)})" && cat > ${shellQuote(path)}`],
    content,
  )
  if (r.exit !== 0) throw new Error(`writeFile: ${r.stderr}`)
}

export const listDir = async (sessionId: string, path: string) => {
  const r = await rawExec(sessionId, ["/bin/sh", "-c", `ls -la --time-style=full-iso ${shellQuote(path)}`])
  return truncate(r.stdout).text
}

export const editFile = async (sessionId: string, path: string, find: string, replace: string) => {
  const findB64 = Buffer.from(find).toString("base64")
  const replaceB64 = Buffer.from(replace).toString("base64")
  const code = `
import base64, sys, pathlib
p = pathlib.Path(${JSON.stringify(path)})
if not p.exists():
    print(f"ERROR: file not found: {p}", file=sys.stderr); sys.exit(1)
find = base64.b64decode("${findB64}").decode("utf-8")
replace = base64.b64decode("${replaceB64}").decode("utf-8")
text = p.read_text()
c = text.count(find)
if c == 0:
    print("ERROR: string to replace not found", file=sys.stderr); sys.exit(1)
if c > 1:
    print(f"ERROR: string occurs {c} times — include more context to make it unique", file=sys.stderr); sys.exit(1)
p.write_text(text.replace(find, replace, 1))
print(f"OK: 1 occurrence replaced in {p}")
`
  const r = await rawExec(sessionId, ["/usr/local/bin/python3", "-c", code])
  return { ok: r.exit === 0, output: r.exit === 0 ? r.stdout.trim() : r.stderr.trim(), exit: r.exit }
}

export const search = async (sessionId: string, pattern: string, path = "/workspace", glob?: string) => {
  const args = ["rg", "-n", "--no-heading", "--max-count=200", "-S"]
  if (glob) args.push("-g", glob)
  args.push("--", pattern, path)
  const r = await rawExec(sessionId, args, undefined, 30000)
  const t = truncate(r.stdout)
  return { output: t.text, exit: r.exit, truncated: t.truncated }
}

export const python = async (sessionId: string, code: string, timeout = 60): Promise<ExecResult> => {
  const codeB64 = Buffer.from(code).toString("base64")
  const cmd = `echo ${codeB64} | base64 -d | python3 -`
  return bash(sessionId, cmd, timeout)
}

export const fetchUrl = async (sessionId: string, url: string, timeout = 30) => {
  if (!/^https?:\/\//i.test(url)) return { status: 0, body: "", error: "url must be http(s)://", truncated: false }
  const cmd = `curl -sS -L --max-time ${timeout} -o /tmp/.fetch_body -w "%{http_code}" ${shellQuote(url)} && head -c 262144 /tmp/.fetch_body && echo`
  const r = await bash(sessionId, cmd, timeout + 10)
  const tail = r.stdout
  const m = tail.match(/^(\d{3})/)
  const status = m ? Number(m[1]) : 0
  const body = m ? tail.slice(m[0].length) : tail
  return { status, body, truncated: r.truncated, exit: r.exit }
}

export const pipInstall = async (sessionId: string, packages: string[]) => {
  const safe = packages.filter((p) => /^[A-Za-z0-9_.\-+\[\]=<>~]+$/.test(p))
  if (safe.length === 0) return { ok: false, output: "no valid package names", exit: 1 }
  const r = await bash(sessionId, `pip install --quiet --no-cache-dir ${safe.map(shellQuote).join(" ")}`, 300)
  return { ok: r.exit === 0, output: (r.stdout + r.stderr).trim().slice(0, 8192), exit: r.exit }
}

export const aptInstall = async (sessionId: string, packages: string[]) => {
  const safe = packages.filter((p) => /^[A-Za-z0-9_.\-+]+$/.test(p))
  if (safe.length === 0) return { ok: false, output: "no valid package names", exit: 1 }
  const cmd = `apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ${safe.map(shellQuote).join(" ")}`
  const r = await bash(sessionId, cmd, 600)
  return { ok: r.exit === 0, output: (r.stdout + r.stderr).trim().slice(0, 8192), exit: r.exit }
}

const UPLOAD_DIR = "/workspace/uploads"
const ALLOWED_ROOT = "/workspace"

const sanitizeFilename = (name: string) => {
  const base = name.split("/").pop() ?? "file"
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "").slice(0, 200)
  return cleaned || "file"
}

export const uploadFile = async (
  sessionId: string,
  filename: string,
  bytes: Uint8Array,
): Promise<{ path: string; name: string; size: number; mime: string }> => {
  await acquire(sessionId)
  await rawExec(sessionId, ["mkdir", "-p", UPLOAD_DIR])
  const safe = sanitizeFilename(filename)
  const dest = `${UPLOAD_DIR}/${safe}`

  const tmpRoot = await mkdtemp(join(tmpdir(), "harness-up-"))
  const tmp = join(tmpRoot, safe)
  await Bun.write(tmp, bytes)
  try {
    const r = await kctl(["-n", NS, "cp", "-c", CONTAINER, tmp, `${podName(sessionId)}:${dest}`])
    if (r.exit !== 0) throw new Error(`kubectl cp failed: ${r.stderr || r.stdout}`)
  } finally {
    await unlink(tmp).catch(() => {})
  }
  return { path: dest, name: safe, size: bytes.length, mime: guessMime(dest) }
}

export const downloadFile = async (
  sessionId: string,
  path: string,
): Promise<{ stream: ReadableStream<Uint8Array>; mime: string; size: number; name: string }> => {
  if (!path.startsWith(`${ALLOWED_ROOT}/`) && path !== ALLOWED_ROOT) {
    throw new Error("path must be under /workspace")
  }
  await acquire(sessionId)
  const statR = await rawExec(sessionId, ["stat", "-c", "%s", path])
  if (statR.exit !== 0) throw new Error(`file not found: ${path}`)
  const size = Number(statR.stdout.trim()) || 0
  const name = path.split("/").pop() ?? "file"
  const proc = Bun.spawn(
    [KUBECTL, "--context", CONTEXT, "-n", NS, "exec", podName(sessionId), "-c", CONTAINER, "--", "cat", path],
    { stdout: "pipe", stderr: "ignore" },
  )
  return { stream: proc.stdout as unknown as ReadableStream<Uint8Array>, mime: guessMime(path), size, name }
}

const MAX_INLINE_TEXT = 256 * 1024
const MAX_INLINE_IMAGE = 1024 * 1024

export const attachFile = async (
  sessionId: string,
  path: string,
): Promise<{
  path: string
  name: string
  mime: string
  size: number
  text?: string
  dataUrl?: string
  downloadUrl: string
}> => {
  if (!path.startsWith(`${ALLOWED_ROOT}/`)) throw new Error("path must be under /workspace")
  await acquire(sessionId)
  const statR = await rawExec(sessionId, ["stat", "-c", "%s", path])
  if (statR.exit !== 0) throw new Error(`file not found: ${path}`)
  const size = Number(statR.stdout.trim()) || 0
  const name = path.split("/").pop() ?? "file"
  const mime = guessMime(path)
  const downloadUrl = `/api/sandbox/file?sessionId=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}`

  if (isTextLike(mime) && size <= MAX_INLINE_TEXT) {
    const r = await rawExec(sessionId, ["cat", path])
    return { path, name, mime, size, text: r.stdout, downloadUrl }
  }
  if (isImage(mime) && size <= MAX_INLINE_IMAGE) {
    const r = await rawExec(sessionId, ["base64", "-w", "0", path])
    return { path, name, mime, size, dataUrl: `data:${mime};base64,${r.stdout.trim()}`, downloadUrl }
  }
  return { path, name, mime, size, downloadUrl }
}

export const release = async (sessionId: string) => {
  await kctl(["-n", NS, "delete", "pod", podName(sessionId), "--wait=false", "--ignore-not-found"])
  ready.delete(sessionId)
}

const shellQuote = (s: string) => "'" + s.replace(/'/g, `'\\''`) + "'"
