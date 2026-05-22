import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))

// ---- bundled find-skills SKILL.md (the default-attached skill) ----------------

let _findSkillsMd: string | null = null
export const getFindSkillsMd = async (): Promise<string> => {
  if (_findSkillsMd) return _findSkillsMd
  _findSkillsMd = await readFile(join(__dirname, "find-skills.md"), "utf8")
  return _findSkillsMd
}

export const FIND_SKILLS = {
  id: "vercel-labs/skills/find-skills",
  source: "vercel-labs/skills",
  skillId: "find-skills",
}

// ---- skills.sh integration ----------------------------------------------------

const SKILLS_API = "https://www.skills.sh/api"
const GH_RAW = "https://raw.githubusercontent.com"
const GH_API = "https://api.github.com"

const MAX_FILE_BYTES = 200 * 1024 // 200 KB per file
const MAX_BUNDLE_BYTES = 2 * 1024 * 1024 // 2 MB total per skill

const BINARY_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".tiff",
  ".pdf", ".zip", ".tar", ".gz", ".tgz", ".bz2", ".xz",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".mp3", ".mp4", ".mov", ".webm", ".ogg", ".wav",
  ".so", ".dylib", ".dll", ".exe", ".bin",
])

const extOf = (path: string) => {
  const i = path.lastIndexOf(".")
  return i === -1 ? "" : path.slice(i).toLowerCase()
}

export type SearchHit = {
  id: string
  skillId: string
  name: string
  installs: number
  source: string
}

export const searchSkills = async (q: string, limit = 10): Promise<SearchHit[]> => {
  if (q.trim().length < 2) return []
  const url = `${SKILLS_API}/search?q=${encodeURIComponent(q)}&limit=${limit}`
  const r = await fetch(url, { headers: { accept: "application/json" } })
  if (!r.ok) throw new Error(`skills.sh search ${r.status}`)
  const data = (await r.json()) as { skills?: SearchHit[] }
  return data.skills ?? []
}

// ---- frontmatter ---------------------------------------------------------------

export type SkillFrontmatter = { name?: string; description?: string }

export const parseFrontmatter = (md: string): SkillFrontmatter => {
  if (!md.startsWith("---")) return {}
  const end = md.indexOf("\n---", 3)
  if (end === -1) return {}
  const block = md.slice(3, end).trim()
  const out: SkillFrontmatter = {}
  let key: string | null = null
  let value = ""
  for (const line of block.split("\n")) {
    const m = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(line)
    if (m) {
      if (key) (out as Record<string, string>)[key] = value.trim()
      key = m[1] ?? null
      value = m[2] ?? ""
      continue
    }
    if (key) value += " " + line.trim()
  }
  if (key) (out as Record<string, string>)[key] = value.trim()
  return out
}

// ---- repo + tree resolution ---------------------------------------------------

type RepoRef = { owner: string; name: string; branch: string }
type ResolvedSkill = RepoRef & { skillDir: string; skillMd: string }

const repoCache = new Map<string, RepoRef>()
const treeCache = new Map<string, string[]>() // key: "<owner>/<name>@<branch>"
const skillCache = new Map<string, ResolvedSkill>() // key: "<source>/<skillId>"

// Use GitHub's repo redirect handling: even moved/renamed repos return a 200
// after fetch's automatic redirect follow, with the canonical name in
// `full_name`. So we always trust what GitHub gives us.
const resolveRepo = async (source: string): Promise<RepoRef> => {
  const cached = repoCache.get(source)
  if (cached) return cached
  const r = await fetch(`${GH_API}/repos/${source}`, { headers: { accept: "application/vnd.github+json" } })
  if (!r.ok) throw new Error(`repo not found on GitHub: ${source} (${r.status})`)
  const j = (await r.json()) as { full_name: string; default_branch: string }
  const [owner, name] = j.full_name.split("/")
  if (!owner || !name) throw new Error(`bad repo full_name: ${j.full_name}`)
  const out: RepoRef = { owner, name, branch: j.default_branch }
  repoCache.set(source, out)
  return out
}

const getRepoTree = async (repo: RepoRef): Promise<string[]> => {
  const key = `${repo.owner}/${repo.name}@${repo.branch}`
  const cached = treeCache.get(key)
  if (cached) return cached
  const r = await fetch(
    `${GH_API}/repos/${repo.owner}/${repo.name}/git/trees/${repo.branch}?recursive=1`,
    { headers: { accept: "application/vnd.github+json" } },
  )
  if (!r.ok) throw new Error(`tree fetch failed for ${key} (${r.status})`)
  const j = (await r.json()) as {
    truncated: boolean
    tree: Array<{ path: string; type: string }>
  }
  if (j.truncated) console.warn(`[skills] git tree truncated for ${key}; some files may be missing`)
  const paths = j.tree.filter((t) => t.type === "blob").map((t) => t.path)
  treeCache.set(key, paths)
  return paths
}

// candidate dir names to look for, when the skills.sh public slug doesn't
// match the on-disk directory name (e.g. "vercel-react-best-practices" lives in
// "react-best-practices").
const dirNameCandidates = (source: string, skillId: string): string[] => {
  const out = new Set<string>([skillId])
  const ownerSegments = source.split("/")[0]?.split("-") ?? []
  const prefixes = ownerSegments
    .flatMap((_, i) => ownerSegments.slice(0, i + 1).join("-"))
    .map((p) => `${p}-`)
  const repoFirst = source.split("/")[1]?.split("-")[0]
  if (repoFirst) prefixes.push(`${repoFirst}-`)
  for (const p of prefixes) {
    if (skillId.startsWith(p)) out.add(skillId.slice(p.length))
  }
  return [...out]
}

const findSkillMdPath = (paths: string[], source: string, skillId: string): string | null => {
  const dirNames = new Set(dirNameCandidates(source, skillId))
  const scored: Array<{ path: string; score: number }> = []
  for (const p of paths) {
    if (p !== "SKILL.md" && !p.endsWith("/SKILL.md")) continue
    const parts = p.split("/")
    const dir = parts.length === 1 ? "" : parts[parts.length - 2] ?? ""
    if (!dirNames.has(dir)) continue
    // lower score = better match
    const exact = dir === skillId ? 0 : 1
    const inSkillsFolder = p.includes("/skills/") ? 0 : 1
    const depth = parts.length // prefer shallower paths
    scored.push({ path: p, score: exact * 1000 + inSkillsFolder * 100 + depth })
  }
  scored.sort((a, b) => a.score - b.score)
  return scored[0]?.path ?? null
}

const resolveSkill = async (source: string, skillId: string): Promise<ResolvedSkill> => {
  const key = `${source}/${skillId}`
  const cached = skillCache.get(key)
  if (cached) return cached
  const repo = await resolveRepo(source)
  const tree = await getRepoTree(repo)
  const path = findSkillMdPath(tree, source, skillId)
  if (!path)
    throw new Error(
      `SKILL.md not found in ${repo.owner}/${repo.name} for skillId=${skillId}`,
    )
  const skillDir = path === "SKILL.md" ? "" : path.slice(0, -"/SKILL.md".length)
  const raw = await fetch(`${GH_RAW}/${repo.owner}/${repo.name}/${repo.branch}/${path}`)
  if (!raw.ok) throw new Error(`SKILL.md raw fetch failed (${raw.status})`)
  const skillMd = await raw.text()
  const out: ResolvedSkill = { ...repo, skillDir, skillMd }
  skillCache.set(key, out)
  return out
}

export const fetchSkillContent = async (source: string, skillId: string): Promise<string> => {
  const { skillMd } = await resolveSkill(source, skillId)
  return skillMd
}

// ---- bundle (SKILL.md + sibling files) ---------------------------------------

export type SkillFile = { path: string; content: string }

const bundleCache = new Map<string, SkillFile[]>()

const fetchSkillFilesFromTree = async (
  repo: RepoRef,
  tree: string[],
  skillDir: string,
): Promise<SkillFile[]> => {
  const prefix = skillDir ? `${skillDir}/` : ""
  const candidates: string[] = []
  for (const p of tree) {
    if (skillDir ? !p.startsWith(prefix) : false) continue
    const rel = skillDir ? p.slice(prefix.length) : p
    if (rel === "SKILL.md") continue
    if (BINARY_EXT.has(extOf(rel))) continue
    candidates.push(p)
  }
  const out: SkillFile[] = []
  let total = 0
  for (const p of candidates) {
    if (total >= MAX_BUNDLE_BYTES) break
    const url = `${GH_RAW}/${repo.owner}/${repo.name}/${repo.branch}/${p}`
    const r = await fetch(url)
    if (!r.ok) continue
    const text = await r.text()
    const bytes = Buffer.byteLength(text, "utf8")
    if (bytes > MAX_FILE_BYTES) continue
    if (text.includes("\x00")) continue // skip binary content the ext check missed
    if (total + bytes > MAX_BUNDLE_BYTES) break
    const rel = skillDir ? p.slice(prefix.length) : p
    out.push({ path: rel, content: text })
    total += bytes
  }
  return out
}

export const fetchSkillBundle = async (
  source: string,
  skillId: string,
): Promise<{ skillMd: string; files: SkillFile[]; frontmatter: SkillFrontmatter }> => {
  const resolved = await resolveSkill(source, skillId)
  const key = `${source}/${skillId}`
  const cachedFiles = bundleCache.get(key)
  if (cachedFiles) {
    return { skillMd: resolved.skillMd, files: cachedFiles, frontmatter: parseFrontmatter(resolved.skillMd) }
  }
  const tree = await getRepoTree({ owner: resolved.owner, name: resolved.name, branch: resolved.branch })
  const files = await fetchSkillFilesFromTree(resolved, tree, resolved.skillDir)
  bundleCache.set(key, files)
  return { skillMd: resolved.skillMd, files, frontmatter: parseFrontmatter(resolved.skillMd) }
}

export const skillInstallRoot = (source: string, skillId: string): string =>
  `/workspace/.skills/${source}/${skillId}`
