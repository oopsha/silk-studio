import { EditorService } from "@silk-studio/editor/services/editor/editorServiceFacade.ts";
import { formatErrorMessage } from "../formatErrorMessage";
import { bridgeFetchObjectDdl } from "./connectionDdlBridge";
import {
  buildPlsqlTabLabel,
  isEditableSourceTab,
  isPlsqlSourceLoaded,
  resolvePlsqlSourceRef,
  type PlsqlEditorRef,
} from "./plsqlEditorConstants";
import { PlsqlSnapshotDialogService } from "./plsqlSnapshotDialogService";
import {
  appendPackagePlsqlSnapshot,
  appendPlsqlSnapshot,
  clearPackagePlsqlSnapshots,
  clearPlsqlSnapshots,
  loadPackagePlsqlSnapshots,
  loadPlsqlSnapshots,
  removePackagePlsqlSnapshot,
  removePlsqlSnapshot,
  type PackagePlsqlSnapshotEntry,
  type PlsqlSnapshotEntry,
  type PlsqlSnapshotReason,
} from "./plsqlSnapshotStorage";

export async function listPlsqlSnapshots(ref: PlsqlEditorRef): Promise<PlsqlSnapshotEntry[]> {
  return loadPlsqlSnapshots(ref);
}

export async function recordPlsqlSnapshot(
  ref: PlsqlEditorRef,
  content: string,
  reason: PlsqlSnapshotReason,
): Promise<PlsqlSnapshotEntry | null> {
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

/** Best-effort history write after a database save; snapshot storage must not undo save success. */
export async function recordPlsqlSnapshotBestEffort(
  ref: PlsqlEditorRef,
  content: string,
  reason: PlsqlSnapshotReason,
): Promise<void> {
  try {
    await recordPlsqlSnapshot(ref, content, reason);
  } catch (error) {
    console.error("[silk.plsql.snapshot] Database save succeeded, but local history write failed", error);
  }
}

/** Records Spec + Body together as one snapshot entry — see PackagePlsqlSnapshotEntry's doc comment. */
export async function recordPackagePlsqlSnapshot(
  ref: PlsqlEditorRef,
  spec: string,
  body: string,
  reason: PlsqlSnapshotReason,
): Promise<PackagePlsqlSnapshotEntry | null> {
  const cleanSpec = spec.replace(/^\uFEFF/, "");
  const cleanBody = body.replace(/^\uFEFF/, "");
  if (!cleanSpec.trim() && !cleanBody.trim()) return null;
  const isPlaceholder = (value: string) =>
    value.startsWith("-- Loading source") || value.startsWith("-- Failed to load source");
  if (isPlaceholder(cleanSpec) || isPlaceholder(cleanBody)) return null;
  return appendPackagePlsqlSnapshot(
    ref,
    cleanSpec.endsWith("\n") ? cleanSpec : `${cleanSpec}\n`,
    cleanBody.endsWith("\n") ? cleanBody : `${cleanBody}\n`,
    reason,
  );
}

/** Best-effort package history write after both package DDL sections have been applied. */
export async function recordPackagePlsqlSnapshotBestEffort(
  ref: PlsqlEditorRef,
  spec: string,
  body: string,
  reason: PlsqlSnapshotReason,
): Promise<void> {
  try {
    await recordPackagePlsqlSnapshot(ref, spec, body, reason);
  } catch (error) {
    console.error("[silk.plsql.snapshot] Package database save succeeded, but local history write failed", error);
  }
}

export async function listPackagePlsqlSnapshots(ref: PlsqlEditorRef): Promise<PackagePlsqlSnapshotEntry[]> {
  return loadPackagePlsqlSnapshots(ref);
}

export async function deletePackagePlsqlSnapshotEntry(ref: PlsqlEditorRef, snapshotId: string): Promise<void> {
  if (!(await removePackagePlsqlSnapshot(ref, snapshotId))) {
    throw new Error("Snapshot not found.");
  }
}

export async function clearAllPackagePlsqlSnapshots(ref: PlsqlEditorRef): Promise<void> {
  await clearPackagePlsqlSnapshots(ref);
}

export function getPlsqlSnapshotBlockedReason(tabId?: string): string | null {
  const tab = tabId
    ? EditorService.getTab(tabId)
    : EditorService.getActiveTab();
  if (!tab) {
    return "Active editor is not a PL/SQL source tab.";
  }
  const ref = resolvePlsqlSourceRef(tab.uri);
  if (!ref) {
    return "Active editor is not a PL/SQL source tab.";
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
    ? EditorService.getTab(tabId)
    : EditorService.getActiveTab();
  if (!tab) {
    throw new Error("No active editor.");
  }
  const ref = resolvePlsqlSourceRef(tab.uri);
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

export async function takeManualPlsqlSnapshot(tabId?: string): Promise<PlsqlSnapshotEntry> {
  const current = requireActivePlsqlTab(tabId);
  const entry = await recordPlsqlSnapshot(current.ref, current.content, "manual");
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

export function openPlsqlDeleteConfirm(
  snapshot: PlsqlSnapshotEntry,
  tabId?: string,
): void {
  const current = requireActivePlsqlTab(tabId);
  const existing = PlsqlSnapshotDialogService.getRequest();
  if (existing && existing.tabId === current.tabId) {
    PlsqlSnapshotDialogService.setMode("confirm", {
      snapshot,
      confirmKind: "delete",
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
    confirmKind: "delete",
  });
}

export function openPlsqlClearAllConfirm(tabId?: string): void {
  const current = requireActivePlsqlTab(tabId);
  const existing = PlsqlSnapshotDialogService.getRequest();
  if (existing && existing.tabId === current.tabId) {
    PlsqlSnapshotDialogService.setMode("confirm", {
      snapshot: undefined,
      confirmKind: "clearAll",
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
    confirmKind: "clearAll",
  });
}

export async function deletePlsqlSnapshotEntry(
  ref: PlsqlEditorRef,
  snapshotId: string,
): Promise<void> {
  return removePlsqlSnapshot(ref, snapshotId).then((removed) => {
    if (!removed) throw new Error("Snapshot not found.");
  });
}

export async function clearAllPlsqlSnapshots(ref: PlsqlEditorRef): Promise<void> {
  await clearPlsqlSnapshots(ref);
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
  const tab = EditorService.getTab(tabId);
  if (!tab || !isEditableSourceTab(tab.uri)) {
    throw new Error("PL/SQL tab not found.");
  }
  EditorService.updateTabContent(tabId, snapshot.content);
}

/** Re-fetch DDL from DB and replace buffer as clean baseline. */
export async function reloadPlsqlFromDatabase(tabId: string): Promise<void> {
  const tab = EditorService.getTab(tabId);
  if (!tab) {
    throw new Error("PL/SQL tab not found.");
  }
  const ref = resolvePlsqlSourceRef(tab.uri);
  if (!ref) {
    throw new Error("Active editor is not a PL/SQL source tab.");
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
