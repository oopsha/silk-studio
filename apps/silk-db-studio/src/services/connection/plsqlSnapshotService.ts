import { EditorService } from "@silk-studio/editor/services/editor/editorService.ts";
import { formatErrorMessage } from "../formatErrorMessage";
import { bridgeFetchObjectDdl } from "./connectionDdlBridge";
import {
  buildPlsqlTabLabel,
  isPlsqlEditorTab,
  isPlsqlSourceLoaded,
  parsePlsqlEditorUri,
  type PlsqlEditorRef,
} from "./plsqlEditorConstants";
import { PlsqlSnapshotDialogService } from "./plsqlSnapshotDialogService";
import {
  appendPlsqlSnapshot,
  loadPlsqlSnapshots,
  type PlsqlSnapshotEntry,
  type PlsqlSnapshotReason,
} from "./plsqlSnapshotStorage";

export function listPlsqlSnapshots(ref: PlsqlEditorRef): PlsqlSnapshotEntry[] {
  return loadPlsqlSnapshots(ref);
}

export function recordPlsqlSnapshot(
  ref: PlsqlEditorRef,
  content: string,
  reason: PlsqlSnapshotReason,
): PlsqlSnapshotEntry | null {
  const trimmed = content.replace(/^\uFEFF/, "");
  if (!trimmed.trim()) return null;
  if (
    trimmed.startsWith("-- Loading source") ||
    trimmed.startsWith("-- Failed to load source")
  ) {
    return null;
  }
  return appendPlsqlSnapshot(ref, trimmed.endsWith("\n") ? trimmed : `${trimmed}\n`, reason);
}

export function getPlsqlSnapshotBlockedReason(tabId?: string): string | null {
  const tab = tabId
    ? EditorService.getTabs().find((item) => item.id === tabId)
    : EditorService.getActiveTab();
  if (!tab || !isPlsqlEditorTab(tab.uri)) {
    return "Active editor is not a PL/SQL source tab.";
  }
  const ref = parsePlsqlEditorUri(tab.uri);
  if (!ref) {
    return "Invalid PL/SQL editor tab.";
  }
  if (!isPlsqlSourceLoaded(tab.content)) {
    return "Source is not loaded yet.";
  }
  return null;
}

function requireActivePlsqlTab(tabId?: string): {
  tabId: string;
  ref: PlsqlEditorRef;
  content: string;
  label: string;
} {
  const tab = tabId
    ? EditorService.getTabs().find((item) => item.id === tabId)
    : EditorService.getActiveTab();
  if (!tab) {
    throw new Error("No active editor.");
  }
  const ref = parsePlsqlEditorUri(tab.uri);
  if (!ref) {
    throw new Error("Active editor is not a PL/SQL source tab.");
  }
  if (!isPlsqlSourceLoaded(tab.content)) {
    throw new Error("Source is not loaded yet.");
  }
  return {
    tabId: tab.id,
    ref,
    content: tab.content,
    label: buildPlsqlTabLabel(
      ref.schemaName,
      ref.objectName,
      ref.kind,
      ref.packageBody,
    ),
  };
}

export function openPlsqlSnapshotHistory(tabId?: string): void {
  const current = requireActivePlsqlTab(tabId);
  PlsqlSnapshotDialogService.open({
    mode: "history",
    tabId: current.tabId,
    ref: current.ref,
    objectLabel: current.label,
    bufferContent: current.content,
  });
}

export function takeManualPlsqlSnapshot(tabId?: string): PlsqlSnapshotEntry {
  const current = requireActivePlsqlTab(tabId);
  const entry = recordPlsqlSnapshot(current.ref, current.content, "manual");
  if (!entry) {
    throw new Error("Nothing to snapshot.");
  }
  return entry;
}

export function openPlsqlSnapshotDiff(
  snapshot: PlsqlSnapshotEntry,
  tabId?: string,
): void {
  const current = requireActivePlsqlTab(tabId);
  const existing = PlsqlSnapshotDialogService.getRequest();
  if (existing && existing.tabId === current.tabId) {
    PlsqlSnapshotDialogService.setMode("diff", {
      snapshot,
      bufferContent: current.content,
    });
    return;
  }
  PlsqlSnapshotDialogService.open({
    mode: "diff",
    tabId: current.tabId,
    ref: current.ref,
    objectLabel: current.label,
    bufferContent: current.content,
    snapshot,
  });
}

export function openPlsqlRollbackConfirm(
  snapshot: PlsqlSnapshotEntry,
  tabId?: string,
): void {
  const current = requireActivePlsqlTab(tabId);
  const existing = PlsqlSnapshotDialogService.getRequest();
  if (existing && existing.tabId === current.tabId) {
    PlsqlSnapshotDialogService.setMode("confirm", {
      snapshot,
      confirmKind: "rollback",
      bufferContent: current.content,
    });
    return;
  }
  PlsqlSnapshotDialogService.open({
    mode: "confirm",
    tabId: current.tabId,
    ref: current.ref,
    objectLabel: current.label,
    bufferContent: current.content,
    snapshot,
    confirmKind: "rollback",
  });
}

export function openPlsqlReloadConfirm(tabId?: string): void {
  const current = requireActivePlsqlTab(tabId);
  PlsqlSnapshotDialogService.open({
    mode: "confirm",
    tabId: current.tabId,
    ref: current.ref,
    objectLabel: current.label,
    bufferContent: current.content,
    confirmKind: "reload",
  });
}

/** Restore snapshot into the editor buffer (marks dirty). */
export function rollbackPlsqlSnapshot(
  tabId: string,
  snapshot: PlsqlSnapshotEntry,
): void {
  const tab = EditorService.getTabs().find((item) => item.id === tabId);
  if (!tab || !isPlsqlEditorTab(tab.uri)) {
    throw new Error("PL/SQL tab not found.");
  }
  EditorService.updateTabContent(tabId, snapshot.content);
}

/** Re-fetch DDL from DB and replace buffer as clean baseline. */
export async function reloadPlsqlFromDatabase(tabId: string): Promise<void> {
  const tab = EditorService.getTabs().find((item) => item.id === tabId);
  if (!tab) {
    throw new Error("PL/SQL tab not found.");
  }
  const ref = parsePlsqlEditorUri(tab.uri);
  if (!ref) {
    throw new Error("Invalid PL/SQL editor tab.");
  }
  const result = await bridgeFetchObjectDdl(
    ref.profileId,
    ref.schemaName,
    ref.objectName,
    ref.kind,
    ref.packageBody,
  );
  const source = result.ddl.endsWith("\n") ? result.ddl : `${result.ddl}\n`;
  EditorService.setTabContentBaseline(tabId, source);
}

export function formatPlsqlSnapshotError(
  error: unknown,
  fallback: string,
): string {
  return formatErrorMessage(error, fallback);
}

export function formatSnapshotTimestamp(createdAt: number): string {
  try {
    return new Date(createdAt).toLocaleString();
  } catch {
    return String(createdAt);
  }
}
