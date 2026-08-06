import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { EditorService } from "@silk-studio/editor/services/editor/editorService.ts";
import type { EditorSessionSnapshot } from "@silk-studio/editor/services/editor/editorService.ts";
import {
  loadEditorSessionSnapshot,
  saveEditorSessionSnapshot,
} from "@silk-studio/editor/services/editor/editorSessionStorage.ts";
import { readTextFileAtPath } from "@silk-studio/editor/services/editor/editorFileIO.ts";
import { EditorConnectionBindingService } from "../connection/editorConnectionBindingService";
import type { EditorConnectionBinding } from "../connection/editorConnectionBindingService";

const PERSIST_DEBOUNCE_MS = 400;
/** Cap Hot Exit flush so a stuck write cannot block window close. */
const CLOSE_PERSIST_TIMEOUT_MS = 2_000;

type SessionFileExtras = {
  bindings?: Record<string, EditorConnectionBinding>;
};

type StoredSession = EditorSessionSnapshot & SessionFileExtras;

async function resolveFilesystemTabs(
  snapshot: EditorSessionSnapshot,
): Promise<EditorSessionSnapshot> {
  const tabs = await Promise.all(
    snapshot.tabs.map(async (tab) => {
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

  return { ...snapshot, tabs };
}

function captureStoredSession(): StoredSession {
  const snapshot = EditorService.captureSessionSnapshot();
  const bindings: Record<string, EditorConnectionBinding> = {};
  for (const tab of snapshot.tabs) {
    bindings[tab.id] = EditorConnectionBindingService.getBinding(tab.id);
  }
  return { ...snapshot, bindings };
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
 * Hot Exit: persist open editors (files / untitled / PL/SQL / DDL) and restore
 * on the next launch. Call `EditorService.prepareSessionRestore()` in main
 * before React mounts.
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

    let snapshot: EditorSessionSnapshot | null = raw;
    if (snapshot) {
      snapshot = await resolveFilesystemTabs(snapshot);
    }
    if (disposed) return;

    EditorService.applySessionSnapshot(snapshot);

    if (raw?.bindings) {
      for (const [tabId, binding] of Object.entries(raw.bindings)) {
        EditorConnectionBindingService.setBinding(tabId, binding);
      }
    }

    if (disposed) return;

    unlisteners.push(EditorService.onDidChange(() => schedulePersist()));
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
