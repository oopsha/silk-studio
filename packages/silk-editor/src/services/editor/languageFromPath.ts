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

/** Extra text-like extensions opened via File Open / OS drop (plaintext). */
const EXTRA_TEXT_EXTENSIONS = new Set([
  "txt",
  "log",
  "csv",
  "tsv",
  "conf",
  "ini",
  "env",
  "properties",
  "gitignore",
  "editorconfig",
]);

export function extensionFromPath(path: string): string {
  const base = basenameFromPath(path);
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

/** True when a dropped/opened path should be loaded as a text editor tab. */
export function isOpenableTextPath(path: string): boolean {
  const ext = extensionFromPath(path);
  if (!ext) return false;
  return ext in EXTENSION_LANGUAGE_MAP || EXTRA_TEXT_EXTENSIONS.has(ext);
}

export function languageIdFromPath(path: string): string {
  const extension = extensionFromPath(path);
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
