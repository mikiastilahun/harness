import { Hono } from "hono"
import { zValidator } from "@hono/zod-validator"
import { z } from "zod"
import { streamText, convertToModelMessages, stepCountIs, type UIMessage } from "ai"
import { isValidModel, DEFAULT_MODEL } from "@harness/shared"
import { buildModel } from "../ai/models"
import { baseSystemPrompt } from "../ai/system-prompt"
import { sandboxTools } from "../ai/tools"
import {
  FIND_SKILLS,
  fetchSkillBundle,
  getFindSkillsMd,
  parseFrontmatter,
  skillInstallRoot,
  type SkillFile,
  type SkillFrontmatter,
} from "../skills"
import { writeFile as sandboxWriteFile } from "../sandbox/provider"

const attachedSkill = z.object({
  id: z.string(),
  source: z.string(),
  skillId: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
})

type AttachedSkill = z.infer<typeof attachedSkill>

const body = z.object({
  messages: z.array(z.any()),
  model: z.string().optional(),
  sessionId: z.string().optional(),
  skills: z.array(attachedSkill).optional(),
})

// Per-session record of which skills we've installed into the sandbox so we
// don't re-write the files on every chat turn.
const installed = new Map<string, Set<string>>()

const markInstalled = (sessionId: string, id: string) => {
  let set = installed.get(sessionId)
  if (!set) {
    set = new Set()
    installed.set(sessionId, set)
  }
  set.add(id)
}

const isInstalled = (sessionId: string, id: string) =>
  installed.get(sessionId)?.has(id) ?? false

const installSkillFiles = async (
  sessionId: string,
  source: string,
  skillId: string,
  skillMd: string,
  others: SkillFile[],
): Promise<void> => {
  const root = skillInstallRoot(source, skillId)
  await sandboxWriteFile(sessionId, `${root}/SKILL.md`, skillMd)
  for (const f of others) {
    await sandboxWriteFile(sessionId, `${root}/${f.path}`, f.content)
  }
}

type LoadedSkill = {
  id: string
  source: string
  skillId: string
  frontmatter: SkillFrontmatter
  fileCount: number // not including SKILL.md
}

const loadAndInstall = async (
  sessionId: string,
  source: string,
  skillId: string,
): Promise<LoadedSkill> => {
  const id = `${source}/${skillId}`
  // find-skills is bundled with the api, not on GitHub
  if (id === FIND_SKILLS.id) {
    const skillMd = await getFindSkillsMd()
    if (!isInstalled(sessionId, id)) {
      await installSkillFiles(sessionId, source, skillId, skillMd, [])
      markInstalled(sessionId, id)
    }
    return { id, source, skillId, frontmatter: parseFrontmatter(skillMd), fileCount: 0 }
  }
  const bundle = await fetchSkillBundle(source, skillId)
  if (!isInstalled(sessionId, id)) {
    await installSkillFiles(sessionId, source, skillId, bundle.skillMd, bundle.files)
    markInstalled(sessionId, id)
  }
  return { id, source, skillId, frontmatter: bundle.frontmatter, fileCount: bundle.files.length }
}

const skillEntry = (s: LoadedSkill, override?: AttachedSkill) => {
  const root = skillInstallRoot(s.source, s.skillId)
  const name = override?.name ?? s.frontmatter.name ?? s.skillId
  const description = override?.description ?? s.frontmatter.description ?? ""
  const filesNote = s.fileCount > 0 ? ` (+ ${s.fileCount} support file${s.fileCount === 1 ? "" : "s"})` : ""
  return `- **${name}** — ${description}\n  source: ${s.source}\n  read: \`${root}/SKILL.md\`${filesNote}`
}

export const chat = new Hono().post("/", zValidator("json", body), async (c) => {
  const input = c.req.valid("json")
  const modelId = input.model && isValidModel(input.model) ? input.model : DEFAULT_MODEL
  const sessionId = input.sessionId ?? "default"

  // find-skills is always-on; user-attached skills come after.
  const userSkills = input.skills ?? []
  const toLoad: Array<{ source: string; skillId: string; override?: AttachedSkill }> = [
    { source: FIND_SKILLS.source, skillId: FIND_SKILLS.skillId },
    ...userSkills.map((s) => ({ source: s.source, skillId: s.skillId, override: s })),
  ]

  // Install + summarize in parallel — but errors on one shouldn't tank the chat.
  const loaded = await Promise.all(
    toLoad.map(async (t) => {
      const s = await loadAndInstall(sessionId, t.source, t.skillId).catch((e) => {
        console.error(`skill install failed for ${t.source}/${t.skillId}:`, (e as Error).message)
        return null
      })
      return s ? skillEntry(s, t.override) : null
    }),
  )

  const skillsBlock = loaded.filter((x): x is string => x !== null).join("\n\n")

  const system = `${baseSystemPrompt}

# Skills

The user has attached one or more skills to this conversation. Each skill is a folder under \`/workspace/.skills/<source>/<skillId>/\` inside your sandbox. \`SKILL.md\` is the entry point; some skills include supporting files (rules, examples) alongside it.

**Read \`SKILL.md\` (and the support files it references) with the \`read_file\` tool when a skill looks relevant** — don't assume the contents. Skills' frontmatter \`description\` below tells you when each one applies.

Attached skills:

${skillsBlock}`

  const result = streamText({
    model: buildModel(modelId),
    system,
    messages: await convertToModelMessages(input.messages as UIMessage[]),
    tools: sandboxTools(sessionId),
    stopWhen: stepCountIs(20),
  })
  return result.toUIMessageStreamResponse()
})
