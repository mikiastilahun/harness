import { Marked } from "marked"
import markedShiki from "marked-shiki"
import { codeToHtml } from "shiki"
import DOMPurify from "dompurify"

const marked = new Marked({
  gfm: true,
  breaks: true,
}).use(
  markedShiki({
    async highlight(code, lang) {
      try {
        return await codeToHtml(code, {
          lang: lang || "text",
          theme: "github-dark",
        })
      } catch {
        return `<pre><code>${code.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!)}</code></pre>`
      }
    },
  }),
)

export const renderMarkdown = async (md: string): Promise<string> => {
  if (!md) return ""
  const html = await marked.parse(md)
  if (typeof window === "undefined") return html
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })
}
