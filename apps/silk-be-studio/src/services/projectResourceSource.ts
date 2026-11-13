import { readDir } from "@tauri-apps/plugin-fs";
import type { ResourceSource } from "@silk-studio/workbench/components/explorer/resourceExplorerTypes.ts";

const HIDDEN_DIRS = new Set([".git", ".gradle", "build", "node_modules", "target"]);

export function createProjectSource(root: string): ResourceSource {
  return {
    root: { id: root, name: root.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || root, directory: true },
    readChildren: async (path) => (await readDir(path))
      .filter((entry) => !(entry.isDirectory && HIDDEN_DIRS.has(entry.name)))
      .map((entry) => ({
        id: `${path.replace(/[\\/]$/, "")}${path.includes("\\") ? "\\" : "/"}${entry.name}`,
        name: entry.name,
        directory: entry.isDirectory && !entry.isSymlink,
      })),
  };
}
