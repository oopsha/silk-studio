import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { EditorGroupsService } from "@silk-studio/editor/services/editor/editorGroupsService.ts";
import type { EditorSessionSnapshotV2 } from "@silk-studio/editor/services/editor/editorSessionTypes.ts";
import {
  loadEditorSessionSnapshot,
  saveEditorSessionSnapshot,
} from "@silk-studio/editor/services/editor/editorSessionStorage.ts";
import { readTextFileAtPath } from "@silk-studio/editor/services/editor/editorFileIO.ts";
import { EditorConnectionBindingService } from "../connection/editorConnectionBindingService";
import type { EditorConnectionBinding } from "../connection/editorConnectionBindingService";
import { ConnectionService } from "../connection/connectionService";
import {
  getPackageDdlBuffer,
  seedPackageDdlBuffers,
  type PackageDdlBufferState,
} from "./packageDdlBufferStore";

const PERSIST_DEBOUNCE_MS = 400;
/** Cap Hot Exit flush so a stuck write cannot block window close. */
const CLOSE_PERSIST_TIMEOUT_MS = 2_000;

type SessionFileExtras = {
  bindings?: Record<string, EditorConnectionBinding>;
  packageDdlBuffers?: Record<string, PackageDdlBufferState>;
};

type StoredSession = EditorSessionSnapshotV2 & SessionFileExtras;

async function resolveFilesystemTabs(
  snapshot: EditorSessionSnapshotV2,
): Promise<EditorSessionSnapshotV2> {
  const groups = await Promise.all(
    snapshot.groups.map(async (group) => {
      const tabs = await Promise.all(
        group.tabs.map(async (tab) => {
          const uri = tab.uri?.trim();
          if (!uri || uri.startsWith("silk://")) {
            return tab;
          }

          if (tab.isDirty) {
            return tab;
          }

          try {
            const disk = await readTextFileAtPath(uri);
            return {
              ...tab,
              content: disk,
              savedContent: disk,
              isDirty: false,
            };
          } catch {
            // Missing/unreadable file: keep backup and mark dirty like VS Code.
            return {
              ...tab,
              isDirty: true,
            };
          }
        }),
      );
      return { ...group, tabs };
    }),
  );

  return { ...snapshot, groups };
}

function captureStoredSession(): StoredSession {
  const snapshot = EditorGroupsService.captureSessionSnapshot();
  const bindings: Record<string, EditorConnectionBinding> = {};
  const packageDdlBuffers: Record<string, PackageDdlBufferState> = {};
  for (const group of snapshot.groups) {
    for (const tab of group.tabs) {
      bindings[tab.id] = EditorConnectionBindingService.getBinding(tab.id);
      const buffer = getPackageDdlBuffer(tab.id);
      if (buffer) {
        packageDdlBuffers[tab.id] = buffer;
      }
    }
  }
  return { ...snapshot, bindings, packageDdlBuffers };
}

async function persistSession(): Promise<void> {
  await saveEditorSessionSnapshot(captureStoredSession());
}

async function persistSessionBeforeClose(): Promise<void> {
  try {
    await Promise.race([
      persistSession(),
      new Promise<void>((resolve) => {
        setTimeout(resolve, CLOSE_PERSIST_TIMEOUT_MS);
      }),
    ]);
  } catch {
    // Persist failure must not block close.
  }
}

/**
 * Hot Exit: persist open editors (files / untitled / PL/SQL / DDL) across all
 * editor groups and restore on the next launch. Call
 * `EditorGroupsService.prepareSessionRestore()` in main before React mounts.
 */
export function startEditorSessionSync(): () => void {
  let disposed = false;
  let closing = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const unlisteners: Array<() => void> = [];

  const schedulePersist = () => {
    if (disposed || closing) return;
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void persistSession();
    }, PERSIST_DEBOUNCE_MS);
  };

  void (async () => {
    const raw = (await loadEditorSessionSnapshot()) as StoredSession | null;
    if (disposed) return;

    let snapshot: EditorSessionSnapshotV2 | null = raw;
    if (snapshot) {
      snapshot = await resolveFilesystemTabs(snapshot);
    }
    if (disposed) return;

    // Must run before applySessionSnapshot's re-render mounts any restored package DDL tab —
    // PackageDdlEditorView reads this store from a lazy useState initializer at mount time.
    seedPackageDdlBuffers(raw?.packageDdlBuffers);

    EditorGroupsService.applySessionSnapshot(snapshot);

    if (raw?.bindings) {
      for (const [tabId, binding] of Object.entries(raw.bindings)) {
        EditorConnectionBindingService.setBinding(tabId, binding);
      }
    }

    if (disposed) return;

    // Connect exactly the profiles the restored editor tabs are bound to — not "whatever was
    // last active". No open tabs (or none bound to a connection) means nothing auto-connects.
    const restoredProfileIds = new Set<string>();
    for (const binding of Object.values(raw?.bindings ?? {})) {
      if (binding.profileId) restoredProfileIds.add(binding.profileId);
    }
    if (restoredProfileIds.size > 0) {
      void ConnectionService.initialize().then(() => {
        if (disposed) return;
        return ConnectionService.connectFromRestoredTabs([...restoredProfileIds]);
      });
    }

    unlisteners.push(
      EditorGroupsService.onDidChangeAnyGroup(() => schedulePersist()),
    );
    unlisteners.push(
      EditorConnectionBindingService.onDidChange(() => schedulePersist()),
    );

    if (isTauri()) {
      try {
        const win = getCurrentWindow();
        // Do not call preventDefault: Tauri destroys the window after the
        // handler resolves. Manual destroy requires core:window:allow-destroy.
        const unlistenClose = await win.onCloseRequested(async () => {
          if (closing) return;
          closing = true;
          if (debounceTimer !== null) {
            clearTimeout(debounceTimer);
            debounceTimer = null;
          }
          await persistSessionBeforeClose();
        });
        if (disposed) {
          unlistenClose();
        } else {
          unlisteners.push(unlistenClose);
        }
      } catch {
        // Window API unavailable — rely on debounced persists.
      }
    } else {
      const onPageHide = () => {
        void persistSession();
      };
      window.addEventListener("pagehide", onPageHide);
      unlisteners.push(() => window.removeEventListener("pagehide", onPageHide));
    }

    if (!disposed) {
      schedulePersist();
    }
  })();

  return () => {
    disposed = true;
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }
    for (const unlisten of unlisteners) {
      unlisten();
    }
  };
}
