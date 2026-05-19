import { tool } from "ai"
import { z } from "zod"
import * as sandbox from "../sandbox/provider"

export const sandboxTools = (sessionId: string) => ({
  bash: tool({
    description:
      "Run a shell command in the agent's persistent Linux sandbox (kata micro-VM). Working directory persists across calls. Output limited to 256KB. Combined stdout+stderr is returned along with the exit code.",
    inputSchema: z.object({
      command: z.string().describe("The shell command. Bash syntax."),
      timeout_seconds: z.number().int().min(1).max(600).optional().describe("Timeout in seconds; default 60."),
    }),
    execute: async ({ command, timeout_seconds }) => sandbox.bash(sessionId, command, timeout_seconds ?? 60),
  }),

  python: tool({
    description:
      "Run a Python 3.12 script in the sandbox. Numpy, pandas, scipy, matplotlib, sympy, pint, requests, beautifulsoup4, lxml, pyyaml, httpx are preinstalled. Returns stdout, stderr, exit code.",
    inputSchema: z.object({
      code: z.string().describe("Python source. Use print() to surface results."),
      timeout_seconds: z.number().int().min(1).max(600).optional(),
    }),
    execute: async ({ code, timeout_seconds }) => sandbox.python(sessionId, code, timeout_seconds ?? 60),
  }),

  read_file: tool({
    description: "Read the contents of a file from the sandbox filesystem.",
    inputSchema: z.object({
      path: z.string().describe("Absolute path inside the sandbox."),
    }),
    execute: async ({ path }) => ({ content: await sandbox.readFile(sessionId, path) }),
  }),

  write_file: tool({
    description:
      "Write content to a file in the sandbox. Creates parent directories. Overwrites existing files. Prefer edit_file when modifying an existing file.",
    inputSchema: z.object({
      path: z.string().describe("Absolute path."),
      content: z.string().describe("Full file content."),
    }),
    execute: async ({ path, content }) => {
      await sandbox.writeFile(sessionId, path, content)
      return { ok: true, path, bytes: content.length }
    },
  }),

  edit_file: tool({
    description:
      "Replace exactly one occurrence of `find` with `replace` in a file. Errors if the string is missing or ambiguous (occurs more than once). Always include enough surrounding context for the match to be unique.",
    inputSchema: z.object({
      path: z.string(),
      find: z.string().describe("Exact text to find. Whitespace and indentation must match."),
      replace: z.string().describe("Text to replace it with."),
    }),
    execute: async ({ path, find, replace }) => sandbox.editFile(sessionId, path, find, replace),
  }),

  list_dir: tool({
    description: "List the contents of a directory in the sandbox.",
    inputSchema: z.object({
      path: z.string().describe("Absolute directory path."),
    }),
    execute: async ({ path }) => ({ listing: await sandbox.listDir(sessionId, path) }),
  }),

  search: tool({
    description:
      "Search file contents with ripgrep. Returns up to 200 matches, each as `file:line:content`. Case-smart matching.",
    inputSchema: z.object({
      pattern: z.string().describe("Regex pattern (Rust regex syntax)."),
      path: z.string().optional().describe("Root path; defaults to /workspace."),
      glob: z.string().optional().describe("Glob filter, e.g. '*.py' or '!node_modules'."),
    }),
    execute: async ({ pattern, path, glob }) => sandbox.search(sessionId, pattern, path ?? "/workspace", glob),
  }),

  fetch_url: tool({
    description:
      "Fetch an HTTP(S) URL and return the response body (truncated to 256KB) and status code. Use for web content, API calls, or downloading small text resources.",
    inputSchema: z.object({
      url: z.string().describe("Absolute URL beginning with http:// or https://"),
      timeout_seconds: z.number().int().min(1).max(120).optional(),
    }),
    execute: async ({ url, timeout_seconds }) => sandbox.fetchUrl(sessionId, url, timeout_seconds ?? 30),
  }),

  pip_install: tool({
    description:
      "Install Python packages with pip in the sandbox. Returns trimmed output. Use when a package you need is missing.",
    inputSchema: z.object({
      packages: z.array(z.string()).min(1).describe("Package names (PEP 508 syntax accepted, e.g. 'numpy>=2.0')."),
    }),
    execute: async ({ packages }) => sandbox.pipInstall(sessionId, packages),
  }),

  apt_install: tool({
    description:
      "Install Debian system packages with apt in the sandbox. Runs `apt-get update` then installs. Use when a binary or library is missing (e.g. ffmpeg, poppler-utils).",
    inputSchema: z.object({
      packages: z.array(z.string()).min(1).describe("Debian package names."),
    }),
    execute: async ({ packages }) => sandbox.aptInstall(sessionId, packages),
  }),

  attach_file_to_chat: tool({
    description:
      "Surface a file from the sandbox to the user in the chat — call this for every deliverable the user should see or download (a script you wrote, a generated report, an image, etc). The user gets a download link plus an inline preview when it's text or a small image. Do not use for scratch files.",
    inputSchema: z.object({
      path: z.string().describe("Absolute path under /workspace."),
    }),
    execute: async ({ path }) => sandbox.attachFile(sessionId, path),
  }),
})
