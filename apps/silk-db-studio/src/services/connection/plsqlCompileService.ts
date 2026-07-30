import { ConfigurationService } from "@silk-studio/workbench/platform/configuration/configurationService.ts";
import { EditorService } from "@silk-studio/editor/services/editor/editorService.ts";
import { formatErrorMessage } from "../formatErrorMessage";
import { ConnectionService } from "./connectionService";
import { bridgeCompileObject } from "./connectionCompileBridge";
import {
  applyPlsqlCompileMarkers,
  clearPlsqlCompileMarkers,
} from "./plsqlCompileMarkers";
import {
  isPlsqlEditorTab,
  isPlsqlSourceLoaded,
  parsePlsqlEditorUri,
} from "./plsqlEditorConstants";
import { PlsqlCompileStateService } from "./plsqlCompileStateService";
import { isEditablePlsqlKind } from "./plsqlEditorService";

export function getPlsqlCompileBlockedReason(tabId?: string): string | null {
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
  if (!isEditablePlsqlKind(ref.kind)) {
    return "Compile is only supported for procedures, functions, and packages.";
  }
  if (ConfigurationService.getValue("database.readOnly")) {
    return "Read-only mode is enabled. PL/SQL Compile is blocked.";
  }
  if (!ConnectionService.isConnected()) {
    return "Connect a database profile before compiling.";
  }
  const { connectedProfileId } = ConnectionService.getState();
  if (connectedProfileId !== ref.profileId) {
    return "Connect this profile before compiling.";
  }
  const profile = ConnectionService.getProfile(ref.profileId);
  if (profile?.driverId !== "oracle") {
    return "Compile is available for Oracle only in v1.";
  }
  if (!isPlsqlSourceLoaded(tab.content)) {
    return "Source is not loaded yet.";
  }
  return null;
}

/**
 * Recompiles the DB object for the active (or given) PL/SQL tab.
 * Applies Monaco markers and updates the compile error list state.
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

  const ref = parsePlsqlEditorUri(tab.uri);
  if (!ref) {
    throw new Error("Invalid PL/SQL editor tab.");
  }

  PlsqlCompileStateService.setCompiling(tab.id);
  clearPlsqlCompileMarkers();

  try {
    const result = await bridgeCompileObject(
      ref.schemaName,
      ref.objectName,
      ref.kind,
      ref.kind === "package" ? ref.packageBody === true : undefined,
    );

    PlsqlCompileStateService.setResult(tab.id, result.success, result.errors);
    if (result.errors.length > 0) {
      applyPlsqlCompileMarkers(result.errors);
    } else {
      clearPlsqlCompileMarkers();
    }
  } catch (error) {
    const message = formatErrorMessage(error, "Failed to compile PL/SQL object.");
    PlsqlCompileStateService.setFailed(tab.id, message);
    clearPlsqlCompileMarkers();
    throw error;
  }
}
