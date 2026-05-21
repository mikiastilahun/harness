import * as k8s from "@kubernetes/client-node"
import { Writable, Readable } from "node:stream"
import { guessMime, isTextLike, isImage } from "./mime"

const NS = process.env.SANDBOX_NAMESPACE ?? "harness-sandboxes"
const CONTEXT = process.env.SANDBOX_CONTEXT ?? "kind-harness-agent-sandbox"
const RUNTIME_CLASS = process.env.SANDBOX_RUNTIME_CLASS
const IMAGE = process.env.SANDBOX_IMAGE ?? "harness-sandbox:1"
const IMAGE_PULL_POLICY = process.env.SANDBOX_IMAGE_PULL_POLICY ?? "IfNotPresent"
const CONTAINER = "shell"
const UPLOAD_DIR = "/workspace/uploads"
const ALLOWED_ROOT = "/workspace"
const MAX_BYTES = 256 * 1024

const SANDBOX_GROUP = "agents.x-k8s.io"
const SANDBOX_VERSION = "v1alpha1"
const SANDBOX_PLURAL = "sandboxes"

const kc = new k8s.KubeConfig()
kc.loadFromDefault()
kc.setCurrentContext(CONTEXT)

const core = kc.makeApiClient(k8s.CoreV1Api)
const cuapi = kc.makeApiClient(k8s.CustomObjectsApi)
const execApi = new k8s.Exec(kc)

const ready = new Map<string, Promise<void>>()

// Sandbox name doubles as the pod name created by the agent-sandbox controller,
// so exec uses this directly.
const sandboxName = (sessionId: string) =>
  "harness-sb-" + sessionId.replace(/[^a-z0-9-]/gi, "").toLowerCase().slice(0, 40)

const sanitizeFilename = (name: string) => {
  const base = name.split("/").pop() ?? "file"
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "").slice(0, 200)
  return cleaned || "file"
}

const shellQuote = (s: string) => "'" + s.replace(/'/g, `'\\''`) + "'"

const truncate = (s: string) =>
  s.length > MAX_BYTES
    ? { text: s.slice(0, MAX_BYTES) + "\n[truncated]", truncated: true }
    : { text: s, truncated: false }

const isStatus404 = (e: unknown) => {
  const err = e as { code?: number; statusCode?: number; body?: { code?: number } }
  return err?.code === 404 || err?.statusCode === 404 || err?.body?.code === 404
}

const ensureNamespace = async () => {
  try {
    await core.readNamespace({ name: NS })
  } catch (e) {
    if (!isStatus404(e)) throw e
    await core.createNamespace({ body: { metadata: { name: NS } } })
  }
}

type SandboxCondition = {
  type: string
  status: string
  reason?: string
  message?: string
}

type SandboxCR = {
  metadata?: { name?: string }
  status?: { conditions?: SandboxCondition[] }
}

const isReady = (cr: SandboxCR | undefined) =>
  cr?.status?.conditions?.some((c) => c.type === "Ready" && c.status === "True") ?? false

const sandboxBody = (sessionId: string) => ({
  apiVersion: `${SANDBOX_GROUP}/${SANDBOX_VERSION}`,
  kind: "Sandbox",
  metadata: {
    name: sandboxName(sessionId),
    namespace: NS,
    labels: { "app.kubernetes.io/name": "harness-sandbox", "harness.io/session": sessionId },
  },
  spec: {
    podTemplate: {
      spec: {
        ...(RUNTIME_CLASS ? { runtimeClassName: RUNTIME_CLASS } : {}),
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
    },
  },
})

const getSandbox = async (name: string): Promise<SandboxCR> => {
  const cr = (await cuapi.getNamespacedCustomObject({
    group: SANDBOX_GROUP,
    version: SANDBOX_VERSION,
    namespace: NS,
    plural: SANDBOX_PLURAL,
    name,
  })) as SandboxCR
  return cr
}

const ensureSandbox = async (sessionId: string) => {
  const name = sandboxName(sessionId)
  try {
    const cr = await getSandbox(name)
    if (isReady(cr)) return
  } catch (e) {
    if (!isStatus404(e)) throw e
    await cuapi.createNamespacedCustomObject({
      group: SANDBOX_GROUP,
      version: SANDBOX_VERSION,
      namespace: NS,
      plural: SANDBOX_PLURAL,
      body: sandboxBody(sessionId),
    })
  }
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    const cr = await getSandbox(name)
    if (isReady(cr)) return
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error("sandbox did not become Ready within 90s")
}

const acquire = async (sessionId: string) => {
  const existing = ready.get(sessionId)
  if (existing) return existing
  const p = (async () => {
    await ensureNamespace()
    await ensureSandbox(sessionId)
  })()
  ready.set(sessionId, p)
  try {
    await p
  } catch (e) {
    ready.delete(sessionId)
    throw e
  }
}

type RawResult = { stdout: string; stderr: string; status: "Success" | "Failure"; exitCode: number }

const exitCodeFromStatus = (status: k8s.V1Status | undefined): number => {
  if (!status) return 0
  if (status.status === "Success") return 0
  const cause = status.details?.causes?.find((c) => c.reason === "ExitCode")
  if (cause?.message) {
    const n = Number(cause.message)
    if (!Number.isNaN(n)) return n
  }
  return 1
}

const rawExec = async (
  sessionId: string,
  command: string[],
  stdin?: string | Uint8Array,
): Promise<RawResult> => {
  await acquire(sessionId)
  const stdoutChunks: Buffer[] = []
  const stderrChunks: Buffer[] = []
  const out = new Writable({
    write(chunk, _enc, cb) {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      cb()
    },
  })
  const err = new Writable({
    write(chunk, _enc, cb) {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      cb()
    },
  })
  const stdinStream = stdin
    ? Readable.from([typeof stdin === "string" ? Buffer.from(stdin, "utf8") : Buffer.from(stdin)])
    : null
  return new Promise<RawResult>((resolve, reject) => {
    execApi
      .exec(NS, sandboxName(sessionId), CONTAINER, command, out, err, stdinStream, false, (status) => {
        resolve({
          stdout: Buffer.concat(stdoutChunks).toString("utf8"),
          stderr: Buffer.concat(stderrChunks).toString("utf8"),
          status: (status?.status as "Success" | "Failure") ?? "Success",
          exitCode: exitCodeFromStatus(status),
        })
      })
      .catch(reject)
  })
}

export const bash = async (sessionId: string, command: string, timeout = 60) => {
  const r = await rawExec(sessionId, ["/bin/bash", "-lc", `timeout ${timeout} bash -c ${shellQuote(command)} 2>&1`])
  const t = truncate(r.stdout)
  return { stdout: t.text, stderr: r.stderr, exit: r.exitCode, truncated: t.truncated }
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
  if (r.status !== "Success") throw new Error(`writeFile: ${r.stderr || r.stdout}`)
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
  const ok = r.status === "Success"
  return { ok, output: ok ? r.stdout.trim() : r.stderr.trim(), exit: r.exitCode }
}

export const search = async (sessionId: string, pattern: string, path = "/workspace", glob?: string) => {
  const args = ["rg", "-n", "--no-heading", "--max-count=200", "-S"]
  if (glob) args.push("-g", glob)
  args.push("--", pattern, path)
  const r = await rawExec(sessionId, args)
  const t = truncate(r.stdout)
  return { output: t.text, exit: r.exitCode, truncated: t.truncated }
}

export const python = async (sessionId: string, code: string, timeout = 60) => {
  const codeB64 = Buffer.from(code).toString("base64")
  const cmd = `echo ${codeB64} | base64 -d | python3 -`
  return bash(sessionId, cmd, timeout)
}

export const fetchUrl = async (sessionId: string, url: string, timeout = 30) => {
  if (!/^https?:\/\//i.test(url)) return { status: 0, body: "", error: "url must be http(s)://", truncated: false }
  const cmd = `curl -sS -L --max-time ${timeout} -o /tmp/.fetch_body -w "%{http_code}" ${shellQuote(url)} && head -c 262144 /tmp/.fetch_body && echo`
  const r = await bash(sessionId, cmd, timeout + 10)
  const m = r.stdout.match(/^(\d{3})/)
  const status = m ? Number(m[1]) : 0
  const body = m ? r.stdout.slice(m[0].length) : r.stdout
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

export const uploadFile = async (
  sessionId: string,
  filename: string,
  bytes: Uint8Array,
): Promise<{ path: string; name: string; size: number; mime: string }> => {
  await acquire(sessionId)
  const safe = sanitizeFilename(filename)
  const dest = `${UPLOAD_DIR}/${safe}`
  await rawExec(sessionId, ["mkdir", "-p", UPLOAD_DIR])
  const r = await rawExec(sessionId, ["/bin/sh", "-c", `cat > ${shellQuote(dest)}`], bytes)
  if (r.status !== "Success") throw new Error(`upload failed: ${r.stderr || r.stdout}`)
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
  const stat = await rawExec(sessionId, ["stat", "-c", "%s", path])
  if (stat.status !== "Success") throw new Error(`file not found: ${path}`)
  const size = Number(stat.stdout.trim()) || 0
  const name = path.split("/").pop() ?? "file"
  const mime = guessMime(path)

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const out = new Writable({
        write(chunk, _enc, cb) {
          controller.enqueue(Buffer.isBuffer(chunk) ? new Uint8Array(chunk) : new Uint8Array(Buffer.from(chunk)))
          cb()
        },
      })
      const err = new Writable({
        write(_chunk, _enc, cb) {
          cb()
        },
      })
      execApi
        .exec(NS, sandboxName(sessionId), CONTAINER, ["/bin/cat", path], out, err, null, false, (status) => {
          if (status && status.status !== "Success") controller.error(new Error(status.message ?? "download failed"))
          else controller.close()
        })
        .catch((e) => controller.error(e))
    },
  })
  return { stream, mime, size, name }
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
  const stat = await rawExec(sessionId, ["stat", "-c", "%s", path])
  if (stat.status !== "Success") throw new Error(`file not found: ${path}`)
  const size = Number(stat.stdout.trim()) || 0
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
  try {
    await cuapi.deleteNamespacedCustomObject({
      group: SANDBOX_GROUP,
      version: SANDBOX_VERSION,
      namespace: NS,
      plural: SANDBOX_PLURAL,
      name: sandboxName(sessionId),
    })
  } catch (e) {
    if (!isStatus404(e)) throw e
  }
  ready.delete(sessionId)
}
