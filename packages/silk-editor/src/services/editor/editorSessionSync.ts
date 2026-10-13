import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { EditorGroupsService } from "./editorGroupsService";
import type { EditorSessionSnapshotV2 } from "./editorSessionTypes";
import {
  loadEditorSessionSnapshot,
  saveEditorSessionSnapshot,
} from "./editorSessionStorage";
import { readTextFileAtPath } from "./editorFileIO";

const PERSIST_DEBOUNCE_MS = 400;
const CLOSE_PERSIST_TIMEOUT_MS = 2_000;

export type StoredEditorSession = EditorSessionSnapshotV2 & Record<string, unknown>;

export type EditorSessionSyncOptions = {
  /** Separate session files and browser storage for apps sharing silk-editor. */
  storageScope?: string;
  captureSnapshot?: (
    snapshot: EditorSessionSnapshotV2,
  ) => StoredEditorSession;
  beforeRestore?: (
    stored: StoredEditorSession | null,
    snapshot: EditorSessionSnapshotV2 | null,
  ) => void | Promise<void>;
  afterRestore?: (
    stored: StoredEditorSession | null,
    isActive: () => boolean,
  ) => void | Promise<void>;
  subscribeToChanges?: (
    schedulePersist: () => void,
  ) => Array<() => void>;
};

async function resolveFilesystemTabs(
  snapshot: EditorSessionSnapshotV2,
): Promise<EditorSessionSnapshotV2> {
  const groups = await Promise.all(
    snapshot.groups.map(async (group) => ({
      ...group,
      tabs: await Promise.all(
        group.tabs.map(async (tab) => {
          const uri = tab.uri?.trim();
          if (!uri || uri.startsWith("silk://") || tab.isDirty) return tab;

          try {
            const disk = await readTextFileAtPath(uri);
            return { ...tab, content: disk, savedContent: disk, isDirty: false };
          } catch {
            // Keep the backup content and mark missing files dirty, like VS Code.
            return { ...tab, isDirty: true };
          }
        }),
      ),
    })),
  );
  return { ...snapshot, groups };
}

/** Persist and restore editor tabs and groups across application launches. */
export function startEditorSessionSync(
  options: EditorSessionSyncOptions = {},
): () => void {
  let disposed = false;
  let closing = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const unlisteners: Array<() => void> = [];

  const persistSession = async () => {
    const snapshot = EditorGroupsService.captureSessionSnapshot();
    await saveEditorSessionSnapshot(
      options.captureSnapshot?.(snapshot) ?? snapshot,
      options.storageScope,
    );
  };

  const persistBeforeClose = async () => {
    try {
      await Promise.race([
        persistSession(),
        new Promise<void>((resolve) => setTimeout(resolve, CLOSE_PERSIST_TIMEOUT_MS)),
      ]);
    } catch {
      // A failed session write must not prevent closing the application.
    }
  };

  const schedulePersist = () => {
    if (disposed || closing) return;
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void persistSession();
    }, PERSIST_DEBOUNCE_MS);
  };

  void (async () => {
    const stored = (await loadEditorSessionSnapshot(
      options.storageScope,
    )) as StoredEditorSession | null;
    if (disposed) return;

    let snapshot = stored as EditorSessionSnapshotV2 | null;
    if (snapshot) snapshot = await resolveFilesystemTabs(snapshot);
    if (disposed) return;

    await options.beforeRestore?.(stored, snapshot);
    if (disposed) return;

    EditorGroupsService.applySessionSnapshot(snapshot);
    await options.afterRestore?.(stored, () => !disposed);
    if (disposed) return;

    unlisteners.push(
      EditorGroupsService.onDidChangeAnyGroup(() => schedulePersist()),
    );
    unlisteners.push(...(options.subscribeToChanges?.(schedulePersist) ?? []));

    if (isTauri()) {
      try {
        const unlistenClose = await getCurrentWindow().onCloseRequested(async () => {
          if (closing) return;
          closing = true;
          if (debounceTimer !== null) {
            clearTimeout(debounceTimer);
            debounceTimer = null;
          }
          await persistBeforeClose();
        });
        if (disposed) unlistenClose();
        else unlisteners.push(unlistenClose);
      } catch {
        // Debounced writes remain available if the window API cannot be attached.
      }
    } else {
      const onPageHide = () => void persistSession();
      window.addEventListener("pagehide", onPageHide);
      unlisteners.push(() => window.removeEventListener("pagehide", onPageHide));
    }

    if (!disposed) schedulePersist();
  })();

  return () => {
    disposed = true;
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    for (const unlisten of unlisteners) unlisten();
  };
}
