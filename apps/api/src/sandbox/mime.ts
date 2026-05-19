const BY_EXT: Record<string, string> = {
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  json: "application/json",
  yaml: "application/yaml",
  yml: "application/yaml",
  toml: "application/toml",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  log: "text/plain",
  html: "text/html",
  htm: "text/html",
  xml: "application/xml",
  py: "text/x-python",
  js: "application/javascript",
  ts: "application/typescript",
  mjs: "application/javascript",
  jsx: "text/jsx",
  tsx: "text/tsx",
  svelte: "text/svelte",
  go: "text/x-go",
  rs: "text/x-rust",
  java: "text/x-java",
  c: "text/x-c",
  h: "text/x-c",
  cpp: "text/x-c++",
  hpp: "text/x-c++",
  sh: "application/x-sh",
  bash: "application/x-sh",
  zsh: "application/x-sh",
  sql: "application/sql",
  ini: "text/plain",
  conf: "text/plain",
  env: "text/plain",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  zip: "application/zip",
  tar: "application/x-tar",
  gz: "application/gzip",
  wav: "audio/wav",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  webm: "video/webm",
}

export const guessMime = (path: string): string => {
  const ext = path.toLowerCase().split(".").pop() ?? ""
  return BY_EXT[ext] ?? "application/octet-stream"
}

export const isTextLike = (mime: string): boolean =>
  mime.startsWith("text/") ||
  mime === "application/json" ||
  mime === "application/javascript" ||
  mime === "application/typescript" ||
  mime === "application/yaml" ||
  mime === "application/toml" ||
  mime === "application/xml" ||
  mime === "application/x-sh" ||
  mime === "application/sql"

export const isImage = (mime: string): boolean => mime.startsWith("image/") && mime !== "image/svg+xml"
