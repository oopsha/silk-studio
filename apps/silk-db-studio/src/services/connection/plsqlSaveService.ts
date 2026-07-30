import { ConfigurationService } from "@silk-studio/workbench/platform/configuration/configurationService.ts";
import { EditorService } from "@silk-studio/editor/services/editor/editorService.ts";
import { formatErrorMessage } from "../formatErrorMessage";
import { QueryExecutionService } from "../query/queryExecutionService";
import { assertReadOnlyQueryAllowed } from "../query/sqlGuard";
import { ConnectionService } from "./connectionService";
import { ConnectionTreeService } from "./connectionTreeService";
import {
  buildPlsqlTabLabel,
  isPlsqlEditorTab,
  isPlsqlSourceLoaded,
  parsePlsqlEditorUri,
  type PlsqlEditorRef,
} from "./plsqlEditorConstants";
import { PlsqlSaveDialogService } from "./plsqlSaveDialogService";
import { buildPlsqlSaveSql } from "./plsqlSaveSql";
import { recordPlsqlSnapshot } from "./plsqlSnapshotService";
import { bridgeFetchObjectDdl } from "./connectionDdlBridge";

function assertSaveAllowed(ref: PlsqlEditorRef): void {
  const readOnly = ConfigurationService.getValue("database.readOnly");
  if (readOnly) {
    throw new Error(
      "Read-only mode is enabled. PL/SQL Save (CREATE OR REPLACE) is blocked.",
    );
  }
  if (!ConnectionService.isConnected()) {
    throw new Error("Connect a database profile before saving PL/SQL.");
  }
  const { connectedProfileId } = ConnectionService.getState();
  if (connectedProfileId !== ref.profileId) {
    throw new Error("Connect this profile before saving PL/SQL.");
  }
}

export function getPlsqlSaveBlockedReason(tabId?: string): string | null {
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
  if (ConfigurationService.getValue("database.readOnly")) {
    return "Read-only mode is enabled. PL/SQL Save is blocked.";
  }
  if (!ConnectionService.isConnected()) {
    return "Connect a database profile before saving PL/SQL.";
  }
  const { connectedProfileId } = ConnectionService.getState();
  if (connectedProfileId !== ref.profileId) {
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

  const ref = parsePlsqlEditorUri(tab.uri);
  if (!ref) {
    throw new Error("Active editor is not a PL/SQL source tab.");
  }

  assertSaveAllowed(ref);

  if (!isPlsqlSourceLoaded(tab.content)) {
    throw new Error("Source is not loaded yet.");
  }

  const { sql, warnings } = buildPlsqlSaveSql(tab.content, ref);
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

  await QueryExecutionService.executeWriteStatement(sql);
  await ConnectionTreeService.invalidateAndRefreshSchema(
    ref.profileId,
    ref.schemaName,
  );

  const tab = EditorService.getTabs().find((item) => item.id === tabId);
  if (tab) {
    recordPlsqlSnapshot(ref, tab.content, "save");
    EditorService.markTabSaved(tabId, tab.uri, tab.label);
  }
}

export function formatPlsqlSaveError(error: unknown, fallback: string): string {
  return formatErrorMessage(error, fallback);
}

/** True when the active (or given) tab should use PL/SQL DB save instead of filesystem. */
export function shouldUsePlsqlSave(uri: string | undefined): boolean {
  return isPlsqlEditorTab(uri);
}
