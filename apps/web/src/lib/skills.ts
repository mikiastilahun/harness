// Client for the /skills/* routes on the api. Search calls hit skills.sh
// indirectly; content calls return the raw SKILL.md text for previews. The
// server fetches the full bundle (SKILL.md + support files) and copies it
// into the sandbox at chat-time; the client only needs metadata.

export type SkillSearchHit = {
  id: string
  skillId: string
  name: string
  installs: number
  source: string
}

export type AttachedSkill = {
  id: string            // "<source>/<skillId>"
  source: string
  skillId: string
  name: string
  description: string
  installs: number
  added_at: number
}

const handle = async <T>(r: Response): Promise<T> => {
  if (!r.ok) {
    const text = await r.text().catch(() => "")
    throw new Error(text || `${r.status} ${r.statusText}`)
  }
  return (await r.json()) as T
}

export const searchSkills = async (q: string, limit = 10): Promise<SkillSearchHit[]> => {
  if (q.trim().length < 2) return []
  const r = await fetch(`/api/skills/search?q=${encodeURIComponent(q)}&limit=${limit}`)
  const { skills } = await handle<{ skills: SkillSearchHit[] }>(r)
  return skills
}

export const loadSkillContent = async (
  source: string,
  skillId: string,
): Promise<{ source: string; skillId: string; content: string; description: string }> => {
  const r = await fetch(
    `/api/skills/content?source=${encodeURIComponent(source)}&skillId=${encodeURIComponent(skillId)}`,
  )
  return handle<{ source: string; skillId: string; content: string; description: string }>(r)
}

export const attachSkillFrom = async (hit: SkillSearchHit): Promise<AttachedSkill> => {
  const { description } = await loadSkillContent(hit.source, hit.skillId)
  return {
    id: hit.id,
    source: hit.source,
    skillId: hit.skillId,
    name: hit.name,
    description,
    installs: hit.installs,
    added_at: Date.now(),
  }
}
