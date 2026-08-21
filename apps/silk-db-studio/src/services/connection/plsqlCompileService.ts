import { ConfigurationService } from "@silk-studio/workbench/platform/configuration/configurationService.ts";
import { EditorService } from "@silk-studio/editor/services/editor/editorServiceFacade.ts";
import { AppNotificationService } from "@silk-studio/workbench/services/notifications/appNotificationService.ts";
import { formatErrorMessage } from "../formatErrorMessage";
import { QueryExecutionService } from "../query/queryExecutionService";
import { assertReadOnlyQueryAllowed } from "../query/sqlGuard";
import { ConnectionService } from "./connectionService";
import { ConnectionTreeService } from "./connectionTreeService";
import { bridgeCompileObject } from "./connectionCompileBridge";
import {
  applyPlsqlCompileMarkers,
  clearPlsqlCompileMarkers,
} from "./plsqlCompileMarkers";
import {
  isEditableSourceTab,
  isPlsqlSourceLoaded,
  resolvePlsqlSourceRef,
  type PlsqlEditorRef,
} from "./plsqlEditorConstants";
import { PlsqlCompileStateService } from "./plsqlCompileStateService";
import { isEditablePlsqlKind, supportsPlsqlSourceEdit } from "./plsqlEditorService";
import { buildPlsqlSaveSql } from "./plsqlSaveSql";
import { recordPlsqlSnapshot } from "./plsqlSnapshotService";
import { supportsCompileDiagnostics } from "../sql/sqlDialect";

export function getPlsqlCompileBlockedReason(tabId?: string): string | null {
  const tab = tabId
    ? EditorService.getTabs().find((item) => item.id === tabId)
    : EditorService.getActiveTab();
  if (!tab || !isEditableSourceTab(tab.uri)) {
    return "Active editor is not a PL/SQL source tab.";
  }
  const ref = resolvePlsqlSourceRef(tab.uri);
  if (!ref) {
    return "Active editor is not a PL/SQL source tab.";
  }
  if (!isEditablePlsqlKind(ref.kind)) {
    return "Compile is only supported for procedures, functions, packages, and views.";
  }
  if (ConfigurationService.getValue("database.readOnly")) {
    return "Read-only mode is enabled. PL/SQL Compile is blocked.";
  }
  if (!ConnectionService.isConnected(ref.profileId)) {
    return "Connect this profile before compiling.";
  }
  const profile = ConnectionService.getProfile(ref.profileId);
  if (!profile || !supportsPlsqlSourceEdit(profile.driverId, ref.kind)) {
    return "Source editing is not supported for this connection/object type.";
  }
  if (!isPlsqlSourceLoaded(tab.content)) {
    return "Source is not loaded yet.";
  }
  if (!tab.content.trim()) {
    return "Source is empty. Nothing to compile.";
  }
  return null;
}

/**
 * Recompiles the just-saved/pushed DB object and reports diagnostics (error markers + the
 * status message shown in the compile panel). Shared by both the fast "Save" action below and
 * the dialog-confirmed save (`executePlsqlSave` in plsqlSaveService.ts) — either way, the DB
 * object was just replaced with the buffer's text, so both paths should surface the same
 * line/column error feedback rather than only the fast path showing it.
 *
 * Deliberately never throws: this step runs *after* the actual save/push already succeeded, so
 * a failure here (e.g. the diagnostics RPC itself erroring) must not be reported as "save
 * failed" to the caller — it's recorded via {@link PlsqlCompileStateService.setFailed} instead,
 * visible in the compile panel same as a real compile error would be.
 */
export async function reportPlsqlCompileDiagnostics(
  tabId: string,
  ref: PlsqlEditorRef,
): Promise<void> {
  PlsqlCompileStateService.setCompiling(tabId);
  clearPlsqlCompileMarkers();
  try {
    const result = await bridgeCompileObject(
      ref.profileId,
      ref.schemaName,
      ref.objectName,
      ref.kind,
      ref.kind === "package" ? ref.packageBody === true : undefined,
    );
    PlsqlCompileStateService.setResult(tabId, result.success, result.errors);
    if (result.errors.length > 0) {
      applyPlsqlCompileMarkers(result.errors);
    } else {
      clearPlsqlCompileMarkers();
    }
  } catch (error) {
    const message = formatErrorMessage(
      error,
      "Failed to read compile diagnostics.",
    );
    PlsqlCompileStateService.setFailed(tabId, message);
    clearPlsqlCompileMarkers();
  }
}

/**
 * Saves the active (or given) PL/SQL tab's *edited buffer* to the DB immediately — no confirm
 * dialog (that's `executePlsqlSave`/the "Compare & Save" flow) — then reports compile
 * diagnostics. It pushes the buffer via `CREATE OR REPLACE` (same SQL the confirm-dialog save
 * would build) so this is meant for a fast edit → save → fix-errors loop.
 *
 * Compiling only the DB-stored version while ignoring unsaved edits was the previous behavior,
 * but it's confusing: the buffer visibly shows your edits while this reported on a different
 * (older) version, which reads as "my changes got reverted." Since there's no dialog to bail
 * out of, a successful push always marks the tab clean and records a snapshot, regardless of
 * whether the compiled result has PL/SQL errors — Oracle still creates/replaces the object (as
 * INVALID if it has errors), so the DB and the buffer are in sync either way.
 */
export async function compileActivePlsqlObject(tabId?: string): Promise<void> {
  const tab = tabId
    ? EditorService.getTabs().find((item) => item.id === tabId)
    : EditorService.getActiveTab();
  if (!tab) return;

  const blocked = getPlsqlCompileBlockedReason(tab.id);
  if (blocked) {
    throw new Error(blocked);
  }

  const ref = resolvePlsqlSourceRef(tab.uri);
  if (!ref) {
    throw new Error("Active editor is not a PL/SQL source tab.");
  }

  const readOnly = ConfigurationService.getValue("database.readOnly");
  const { sql, warnings } = buildPlsqlSaveSql(tab.content, ref);
  assertReadOnlyQueryAllowed(sql, readOnly);

  PlsqlCompileStateService.setCompiling(tab.id);
  clearPlsqlCompileMarkers();

  try {
    await QueryExecutionService.executeWriteStatement(sql, {
      connectionId: ref.profileId,
    });
  } catch (error) {
    const message = formatErrorMessage(error, "Failed to save PL/SQL object.");
    PlsqlCompileStateService.setFailed(tab.id, message);
    clearPlsqlCompileMarkers();
    throw error;
  }

  // The push succeeded — the DB object now matches the buffer, whether or not it's valid
  // PL/SQL, so record it and clear dirty state before reporting compile diagnostics below.
  recordPlsqlSnapshot(ref, tab.content, "compile");
  EditorService.markTabSaved(tab.id, tab.uri, tab.label);
  await ConnectionTreeService.invalidateAndRefreshSchema(
    ref.profileId,
    ref.schemaName,
  );

  if (warnings.length > 0) {
    AppNotificationService.show(warnings.join(" "), "info");
  }

  const profile = ConnectionService.getProfile(ref.profileId);
  if (profile && supportsCompileDiagnostics(profile.driverId)) {
    await reportPlsqlCompileDiagnostics(tab.id, ref);
  }
}
