import { isTauri } from "@tauri-apps/api/core";
import type { EditorSessionSnapshotV2 } from "./editorSessionTypes";
import type { EditorSessionTabSnapshot } from "./editorService";
import { createInitialLayout } from "./editorGroupTypes";

const STORAGE_KEY = "silk-editor.session.v1";
const FILE_NAME = "editor-session.v1.json";

/** Pre-split-editor session shape (flat tabs, single implicit group). */
type EditorSessionSnapshotV1 = {
  version: 1;
  savedAt: number;
  activeTabId: string | null;
  untitledCounter: number;
  tabs: EditorSessionTabSnapshot[];
};

function migrateV1(v1: EditorSessionSnapshotV1): EditorSessionSnapshotV2 {
  const groupId = "group-migrated-v1";
  return {
    version: 2,
    savedAt: v1.savedAt,
    layout: createInitialLayout(groupId),
    focusedGroupId: groupId,
    groups: [
      {
        groupId,
        activeTabId: v1.activeTabId,
        tabs: v1.tabs,
      },
    ],
  };
}

function parseSnapshot(raw: string): EditorSessionSnapshotV2 | null {
  try {
    const parsed = JSON.parse(raw) as
      | EditorSessionSnapshotV1
      | EditorSessionSnapshotV2;
    if (parsed?.version === 2 && Array.isArray(parsed.groups) && parsed.layout) {
      return parsed;
    }
    if (parsed?.version === 1 && Array.isArray(parsed.tabs)) {
      return migrateV1(parsed);
    }
    return null;
  } catch {
    return null;
  }
}

export async function loadEditorSessionSnapshot(): Promise<EditorSessionSnapshotV2 | null> {
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
  snapshot: EditorSessionSnapshotV2,
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
