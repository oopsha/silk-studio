import { isTauri } from "@tauri-apps/api/core";
import type { EditorSessionSnapshot } from "./editorService";

const STORAGE_KEY = "silk-editor.session.v1";
const FILE_NAME = "editor-session.v1.json";

function parseSnapshot(raw: string): EditorSessionSnapshot | null {
  try {
    const parsed = JSON.parse(raw) as EditorSessionSnapshot;
    if (parsed?.version !== 1 || !Array.isArray(parsed.tabs)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function loadEditorSessionSnapshot(): Promise<EditorSessionSnapshot | null> {
  if (isTauri()) {
    try {
      const { BaseDirectory, exists, readTextFile } = await import(
        "@tauri-apps/plugin-fs"
      );
      if (await exists(FILE_NAME, { baseDir: BaseDirectory.AppData })) {
        const raw = await readTextFile(FILE_NAME, {
          baseDir: BaseDirectory.AppData,
        });
        const fromFile = parseSnapshot(raw);
        if (fromFile) return fromFile;
      }
    } catch {
      // Fall through to localStorage.
    }
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return parseSnapshot(raw);
  } catch {
    return null;
  }
}

export async function saveEditorSessionSnapshot(
  snapshot: EditorSessionSnapshot,
): Promise<void> {
  const raw = JSON.stringify(snapshot);

  try {
    localStorage.setItem(STORAGE_KEY, raw);
  } catch {
    // Quota — continue to file when possible.
  }

  if (!isTauri()) return;

  try {
    const { BaseDirectory, writeTextFile } = await import("@tauri-apps/plugin-fs");
    await writeTextFile(FILE_NAME, raw, { baseDir: BaseDirectory.AppData });
  } catch {
    // Ignore; localStorage may still hold a copy.
  }
}
