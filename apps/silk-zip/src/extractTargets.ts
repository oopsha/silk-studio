import { readBrowserCopy, syncStored, writeStored } from "./fileStore";

/** Where an extraction writes: asked from the user, next to the archive, or a fixed folder. */
export type ExtractTarget = "ask" | "here" | "named" | { dir: string };

const RECENT_KEY = "silkZip.recentExtractFolders";
const RECENT_LIMIT = 5;

function separatorOf(path: string): string {
  return path.includes("\\") ? "\\" : "/";
}

export function parentFolder(path: string): string | undefined {
  const index = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return index > 0 ? path.slice(0, index) : undefined;
}

export function joinPath(folder: string, name: string): string {
  return `${folder.replace(/[\\/]+$/, "")}${separatorOf(folder)}${name}`;
}

/** "a.tar.gz" -> "a", "a.7z.001" -> "a", "a.zip" -> "a". */
export function archiveStem(archivePath: string): string {
  const file = archivePath.slice(Math.max(archivePath.lastIndexOf("\\"), archivePath.lastIndexOf("/")) + 1);
  const stem = file
    .replace(/\.(?:\d{3}|z\d{2})$/i, "")
    .replace(/\.tar\.[a-z0-9]+$/i, "")
    .replace(/\.[^.]+$/, "");
  return stem || file || "extracted";
}

export function folderLabel(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const name = trimmed.slice(Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/")) + 1);
  return name || trimmed;
}

function parseFolders(text: string | null): string[] {
  try {
    const value: unknown = JSON.parse(text ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
}

let recentFolders = parseFolders(readBrowserCopy(RECENT_KEY));
void syncStored("recent-folders", () => readBrowserCopy(RECENT_KEY), (text) => { recentFolders = parseFolders(text); });

export function loadRecentFolders(): string[] {
  return recentFolders;
}

export function rememberFolder(path: string): void {
  const key = path.replace(/[\\/]+$/, "").toLowerCase();
  const others = recentFolders.filter((item) => item.replace(/[\\/]+$/, "").toLowerCase() !== key);
  recentFolders = [path, ...others].slice(0, RECENT_LIMIT);
  writeStored("recent-folders", RECENT_KEY, JSON.stringify(recentFolders));
}

export function resolveTargetFolder(target: Exclude<ExtractTarget, "ask">, archivePath: string): string | undefined {
  if (typeof target === "object") return target.dir;
  const parent = parentFolder(archivePath);
  if (!parent) return undefined;
  return target === "named" ? joinPath(parent, archiveStem(archivePath)) : parent;
}
