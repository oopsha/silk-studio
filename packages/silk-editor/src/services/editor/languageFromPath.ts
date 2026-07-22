const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  json: "json",
  css: "css",
  html: "html",
  htm: "html",
  md: "markdown",
  rs: "rust",
  py: "python",
  yml: "yaml",
  yaml: "yaml",
  xml: "xml",
  sql: "sql",
  sh: "shell",
  ps1: "powershell",
};

export function languageIdFromPath(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase();
  if (!extension) return "plaintext";
  return EXTENSION_LANGUAGE_MAP[extension] ?? "plaintext";
}

export function basenameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const segments = normalized.split("/");
  return segments[segments.length - 1] || path;
}

export function codiconForLanguage(languageId: string): string {
  switch (languageId) {
    case "typescript":
    case "javascript":
    case "json":
    case "css":
    case "html":
    case "markdown":
    case "rust":
    case "python":
      return "file-code";
    case "sql":
    case "mysql":
    case "mariadb":
    case "pgsql":
    case "plsql":
    case "tsql":
      return "database";
    default:
      return "file";
  }
}
