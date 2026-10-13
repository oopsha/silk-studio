import { startEditorSessionSync as startSharedEditorSessionSync } from "@silk-studio/editor/services/editor/editorSessionSync.ts";
import type { EditorSessionSnapshotV2 } from "@silk-studio/editor/services/editor/editorSessionTypes.ts";
import type { StoredEditorSession } from "@silk-studio/editor/services/editor/editorSessionSync.ts";
import { EditorConnectionBindingService } from "../connection/editorConnectionBindingService";
import type { EditorConnectionBinding } from "../connection/editorConnectionBindingService";
import { ConnectionService } from "../connection/connectionService";
import {
  getPackageDdlBuffer,
  seedPackageDdlBuffers,
  type PackageDdlBufferState,
} from "./packageDdlBufferStore";

type DbStoredEditorSession = StoredEditorSession & {
  bindings?: Record<string, EditorConnectionBinding>;
  packageDdlBuffers?: Record<string, PackageDdlBufferState>;
};

function captureDbSession(
  snapshot: EditorSessionSnapshotV2,
): DbStoredEditorSession {
  const bindings: Record<string, EditorConnectionBinding> = {};
  const packageDdlBuffers: Record<string, PackageDdlBufferState> = {};
  for (const group of snapshot.groups) {
    for (const tab of group.tabs) {
      bindings[tab.id] = EditorConnectionBindingService.getBinding(tab.id);
      const buffer = getPackageDdlBuffer(tab.id);
      if (buffer) packageDdlBuffers[tab.id] = buffer;
    }
  }
  return { ...snapshot, bindings, packageDdlBuffers };
}

/** Add DB-specific connection and package buffer state to shared editor Hot Exit. */
export function startEditorSessionSync(): () => void {
  return startSharedEditorSessionSync({
    captureSnapshot: captureDbSession,
    beforeRestore: (raw) => {
      const stored = raw as DbStoredEditorSession | null;
      // The package DDL editor reads its buffer on mount during snapshot application.
      seedPackageDdlBuffers(stored?.packageDdlBuffers);
    },
    afterRestore: (raw, isActive) => {
      const stored = raw as DbStoredEditorSession | null;
      if (stored?.bindings) {
        for (const [tabId, binding] of Object.entries(stored.bindings)) {
          EditorConnectionBindingService.setBinding(tabId, binding);
        }
      }

      const restoredProfileIds = new Set<string>();
      for (const binding of Object.values(stored?.bindings ?? {})) {
        if (binding.profileId) restoredProfileIds.add(binding.profileId);
      }
      if (restoredProfileIds.size > 0) {
        void ConnectionService.initialize().then(() =>
          isActive()
            ? ConnectionService.connectFromRestoredTabs([...restoredProfileIds])
            : undefined,
        );
      }
    },
    subscribeToChanges: (schedulePersist) => [
      EditorConnectionBindingService.onDidChange(() => schedulePersist()),
    ],
  });
}
