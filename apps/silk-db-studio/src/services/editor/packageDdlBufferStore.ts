/**
 * Cross-remount / cross-restart store for a package DDL tab's Spec and Body edit buffers.
 *
 * `PackageDdlEditorView` tracks Spec/Body as local component state rather than through
 * `EditorService`'s tab-content system (see that component's own doc comment for why), so
 * neither switching away from the tab and back (which unmounts the component — `EditorArea`
 * only renders the focused tab) nor a full app restart would otherwise preserve unsaved edits.
 * This module is the single source of truth both effects read from and write to.
 */
export type StoredSourceBuffer = {
  /** Last content loaded from the DB (the "clean" baseline), or null if never loaded. */
  loaded: string | null;
  /** Current editor content, possibly dirty relative to `loaded`. */
  current: string;
};

export type PackageDdlBufferState = {
  spec: StoredSourceBuffer;
  body: StoredSourceBuffer;
};

const bufferByTabId = new Map<string, PackageDdlBufferState>();

export function getPackageDdlBuffer(tabId: string): PackageDdlBufferState | undefined {
  return bufferByTabId.get(tabId);
}

export function setPackageDdlBuffer(tabId: string, state: PackageDdlBufferState): void {
  bufferByTabId.set(tabId, state);
}

/** Every buffer currently held, for Hot Exit capture. */
export function getAllPackageDdlBuffers(): Record<string, PackageDdlBufferState> {
  return Object.fromEntries(bufferByTabId);
}

/** Populate the store from a Hot Exit session file, before any package DDL tab mounts. */
export function seedPackageDdlBuffers(
  records: Record<string, PackageDdlBufferState> | undefined,
): void {
  if (!records) return;
  for (const [tabId, state] of Object.entries(records)) {
    bufferByTabId.set(tabId, state);
  }
}
