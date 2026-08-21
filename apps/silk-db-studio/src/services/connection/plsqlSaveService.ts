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
import {
  buildPlsqlTabLabel,
  isEditableSourceTab,
  isPlsqlSourceLoaded,
  resolvePlsqlSourceRef,
  type PlsqlEditorRef,
} from "./plsqlEditorConstants";
import { PlsqlSaveDialogService } from "./plsqlSaveDialogService";
import { registerPendingDdlSave } from "./pendingDdlSaveService";
import { buildPlsqlSaveSql } from "./plsqlSaveSql";
import { recordPlsqlSnapshot } from "./plsqlSnapshotService";
import { bridgeFetchObjectDdl } from "./connectionDdlBridge";
import { reportPlsqlCompileDiagnostics } from "./plsqlCompileService";
import { supportsCompileDiagnostics } from "../sql/sqlDialect";

function assertSaveAllowed(ref: PlsqlEditorRef): void {
  const readOnly = ConfigurationService.getValue("database.readOnly");
  if (readOnly) {
    throw new Error(
      "Read-only mode is enabled. PL/SQL Save (CREATE OR REPLACE) is blocked.",
    );
  }
  if (!ConnectionService.isConnected(ref.profileId)) {
    throw new Error("Connect this profile before saving PL/SQL.");
  }
}

export function getPlsqlSaveBlockedReason(tabId?: string): string | null {
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
  if (ConfigurationService.getValue("database.readOnly")) {
    return "Read-only mode is enabled. PL/SQL Save is blocked.";
  }
  if (!ConnectionService.isConnected(ref.profileId)) {
    return "Connect this profile before saving PL/SQL.";
  }
  if (!isPlsqlSourceLoaded(tab.content)) {
    return "Source is not loaded yet.";
  }
  if (!tab.content.trim()) {
    return "Source is empty. Nothing to save.";
  }
  return null;
}

/**
 * Opens CREATE OR REPLACE preview/confirm for a PL/SQL tab.
 * Returns whether the object was saved successfully.
 */
export async function openPlsqlSaveDialog(tabId?: string): Promise<boolean> {
  const tab = tabId
    ? EditorService.getTabs().find((item) => item.id === tabId)
    : EditorService.getActiveTab();
  if (!tab) return false;

  const ref = resolvePlsqlSourceRef(tab.uri);
  if (!ref) {
    throw new Error("Active editor is not a PL/SQL source tab.");
  }

  assertSaveAllowed(ref);

  if (!isPlsqlSourceLoaded(tab.content)) {
    throw new Error("Source is not loaded yet.");
  }

  const saveDriverId = ConnectionService.getProfile(ref.profileId)?.driverId;
  if (!saveDriverId) {
    throw new Error("Connection profile not found.");
  }
  const { sql, warnings } = buildPlsqlSaveSql(tab.content, ref, saveDriverId);
  assertReadOnlyQueryAllowed(
    sql,
    ConfigurationService.getValue("database.readOnly"),
  );

  const objectLabel = buildPlsqlTabLabel(
    ref.schemaName,
    ref.objectName,
    ref.kind,
    ref.packageBody,
  );

  const openPromise = PlsqlSaveDialogService.open({
    tabId: tab.id,
    ref,
    sql,
    warnings,
    objectLabel,
    bufferContent: tab.content,
    dbSource: null,
    dbSourceError: null,
    dbSourceLoading: true,
  });

  void bridgeFetchObjectDdl(
    ref.profileId,
    ref.schemaName,
    ref.objectName,
    ref.kind,
    ref.packageBody,
  )
    .then((result) => {
      const current = PlsqlSaveDialogService.getRequest();
      if (!current || current.tabId !== tab.id) return;
      const source = result.ddl.endsWith("\n") ? result.ddl : `${result.ddl}\n`;
      PlsqlSaveDialogService.patch({
        dbSource: source,
        dbSourceError: null,
        dbSourceLoading: false,
      });
    })
    .catch((error) => {
      const current = PlsqlSaveDialogService.getRequest();
      if (!current || current.tabId !== tab.id) return;
      PlsqlSaveDialogService.patch({
        dbSource: null,
        dbSourceError: formatErrorMessage(
          error,
          "Failed to load current database source for diff.",
        ),
        dbSourceLoading: false,
      });
    });

  return openPromise;
}

export async function executePlsqlSave(
  tabId: string,
  ref: PlsqlEditorRef,
  sql: string,
): Promise<void> {
  assertSaveAllowed(ref);
  assertReadOnlyQueryAllowed(
    sql,
    ConfigurationService.getValue("database.readOnly"),
  );

  await QueryExecutionService.executeWriteStatement(sql, {
    connectionId: ref.profileId,
  });
  await ConnectionTreeService.invalidateAndRefreshSchema(
    ref.profileId,
    ref.schemaName,
  );

  const tab = EditorService.getTabs().find((item) => item.id === tabId);
  if (tab) {
    // Capture the buffer state as of *now* — the user may keep editing before an eventual
    // commit/rollback, so don't re-read tab.content later.
    const savedContent = tab.content;
    const savedUri = tab.uri;
    const savedLabel = tab.label;

    if (ConnectionTransactionService.isDirty(ref.profileId)) {
      // DDL is transactional here (Postgres/SQL Server with autoCommit off) and a manual
      // commit is now pending — defer the local snapshot/clean-mark until we know the write is
      // durable.
      registerPendingDdlSave(ref.profileId, {
        onCommit: () => {
          const stillOpen = EditorService.getTabs().find((item) => item.id === tabId);
          recordPlsqlSnapshot(ref, savedContent, "save");
          if (stillOpen) {
            EditorService.markTabSaved(tabId, savedUri, savedLabel);
          }
        },
        onRollback: () => {
          AppNotificationService.show(tKey("app.plsql.saveRolledBack"), "info");
        },
      });
      AppNotificationService.show(tKey("app.plsql.savePendingCommit"), "info");
    } else {
      recordPlsqlSnapshot(ref, savedContent, "save");
      EditorService.markTabSaved(tabId, savedUri, savedLabel);
    }
  }

  // Surface the same line/column compile diagnostics the fast "Save" action shows — the DB
  // object was just replaced either way, so this dialog-confirmed path shouldn't leave the
  // user unaware the object came out INVALID. Only Oracle has this diagnostics step; other
  // dialects already surfaced any syntax/reference error as a failed statement above.
  const profile = ConnectionService.getProfile(ref.profileId);
  if (profile && supportsCompileDiagnostics(profile.driverId)) {
    await reportPlsqlCompileDiagnostics(tabId, ref);
  }
}

export function formatPlsqlSaveError(error: unknown, fallback: string): string {
  return formatErrorMessage(error, fallback);
}

/** True when the active (or given) tab should use PL/SQL DB save instead of filesystem. */
export function shouldUsePlsqlSave(uri: string | undefined): boolean {
  return isEditableSourceTab(uri);
}
