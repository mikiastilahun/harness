import { Hono } from "hono"
import { searchSkills, fetchSkillContent, parseFrontmatter } from "../skills"

export const skills = new Hono()
  .get("/search", async (c) => {
    const q = c.req.query("q")?.trim() ?? ""
    const limit = Number(c.req.query("limit") ?? "10")
    if (q.length < 2) return c.json({ skills: [] })
    const results = await searchSkills(q, Math.min(Math.max(limit, 1), 25))
    return c.json({ skills: results })
  })
  .get("/content", async (c) => {
    const source = c.req.query("source")
    const skillId = c.req.query("skillId")
    if (!source || !skillId) return c.json({ error: "source and skillId required" }, 400)
    try {
      const content = await fetchSkillContent(source, skillId)
      const fm = parseFrontmatter(content)
      return c.json({ source, skillId, content, description: fm.description ?? "" })
    } catch (e) {
      return c.json({ error: (e as Error).message }, 404)
    }
  })
