import { ConfigurationService } from "@silk-studio/workbench/platform/configuration/configurationService.ts";
import { EditorService } from "@silk-studio/editor/services/editor/editorServiceFacade.ts";
import { AppNotificationService } from "@silk-studio/workbench/services/notifications/appNotificationService.ts";
import { tKey } from "@silk-studio/workbench/platform/i18n/activeLocale.ts";
import { formatErrorMessage } from "../formatErrorMessage";
import { QueryExecutionService } from "../query/queryExecutionService";
import { assertReadOnlyQueryAllowed } from "../query/sqlGuard";
import { ConnectionService } from "./connectionService";
import { ConnectionTransactionService } from "./connectionTransactionService";
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
import { registerPendingDdlSave } from "./pendingDdlSaveService";
import { buildPlsqlSaveSql } from "./plsqlSaveSql";
import { recordPlsqlSnapshot } from "./plsqlSnapshotService";
import { driverAutoCommitsDdl, supportsCompileDiagnostics } from "../sql/sqlDialect";

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
    return "Compile is only supported for procedures, functions, packages, views, and triggers.";
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
  const saveDriverId = ConnectionService.getProfile(ref.profileId)?.driverId;
  if (!saveDriverId) {
    throw new Error("Connection profile not found.");
  }
  const { statements, warnings } = buildPlsqlSaveSql(tab.content, ref, saveDriverId);
  for (const statement of statements) {
    assertReadOnlyQueryAllowed(statement, readOnly);
  }

  PlsqlCompileStateService.setCompiling(tab.id);
  clearPlsqlCompileMarkers();

  try {
    // Sequential, not parallel — see executePlsqlSave's identical comment (a VIEW buffer can
    // carry trailing COMMENT ON statements after the CREATE/ALTER VIEW).
    for (let index = 0; index < statements.length; index += 1) {
      try {
        // eslint-disable-next-line no-await-in-loop -- must run in exact array order, not in parallel.
        await QueryExecutionService.executeWriteStatement(statements[index], {
          connectionId: ref.profileId,
        });
      } catch (error) {
        const message = formatErrorMessage(
          error,
          `Failed to execute statement ${index + 1} of ${statements.length}.`,
        );
        if (index > 0) {
          const committedNote = driverAutoCommitsDdl(saveDriverId)
            ? " and are already committed"
            : "";
          throw new Error(
            `${message} Statements 1-${index} already ran${committedNote} — see the SQL tab for what ran and what didn't.`,
          );
        }
        throw new Error(message);
      }
    }
  } catch (error) {
    const message = formatErrorMessage(error, "Failed to save PL/SQL object.");
    PlsqlCompileStateService.setFailed(tab.id, message);
    clearPlsqlCompileMarkers();
    throw error;
  }

  // The push succeeded — the DB object now matches the buffer, whether or not it's valid
  // PL/SQL. Capture the buffer state as of *now* (the user may keep editing before an eventual
  // commit/rollback, so don't re-read tab.content later).
  const savedContent = tab.content;
  const savedUri = tab.uri;
  const savedLabel = tab.label;

  if (ConnectionTransactionService.isDirty(ref.profileId)) {
    // DDL is transactional here (Postgres/SQL Server with autoCommit off) and a manual commit
    // is now pending — defer the local snapshot/clean-mark until we know the write is durable.
    registerPendingDdlSave(ref.profileId, {
      onCommit: () => {
        const stillOpen = EditorService.getTabs().find((item) => item.id === tab.id);
        recordPlsqlSnapshot(ref, savedContent, "compile");
        if (stillOpen) {
          EditorService.markTabSaved(tab.id, savedUri, savedLabel);
        }
      },
      onRollback: () => {
        AppNotificationService.show(tKey("app.plsql.saveRolledBack"), "info");
      },
    });
    AppNotificationService.show(tKey("app.plsql.savePendingCommit"), "info");
  } else {
    recordPlsqlSnapshot(ref, savedContent, "compile");
    EditorService.markTabSaved(tab.id, savedUri, savedLabel);
    AppNotificationService.show(tKey("app.plsql.saveSucceeded"), "success");
  }

  await ConnectionTreeService.invalidateAndRefreshSchema(
    ref.profileId,
    ref.schemaName,
    ref.catalogName ?? undefined,
  );

  if (warnings.length > 0) {
    AppNotificationService.show(warnings.join(" "), "info");
  }

  if (supportsCompileDiagnostics(saveDriverId)) {
    await reportPlsqlCompileDiagnostics(tab.id, ref);
  } else {
    // Non-Oracle drivers have no separate compile step (the push above already *is* the
    // "compile") and never call setResult/setFailed past this point, so the "compiling" status
    // set at the top of this function would otherwise never resolve — leaving canCompile stuck
    // false and the button permanently disabled after the very first successful save.
    PlsqlCompileStateService.clear(tab.id);
  }
}
