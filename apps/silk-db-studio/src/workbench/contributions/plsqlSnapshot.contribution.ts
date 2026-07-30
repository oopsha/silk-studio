import { MenuId } from "@silk-studio/workbench/platform/actions/menuId.ts";
import { MenuRegistry } from "@silk-studio/workbench/platform/actions/menuRegistry.ts";
import { CommandsRegistry } from "@silk-studio/workbench/platform/commands/commandRegistry.ts";
import { EditorService } from "@silk-studio/editor/services/editor/editorService.ts";
import { formatErrorMessage } from "../../services/formatErrorMessage";
import { shouldUsePlsqlSave } from "../../services/connection/plsqlSaveService";
import {
  openPlsqlReloadConfirm,
  openPlsqlSnapshotHistory,
  takeManualPlsqlSnapshot,
} from "../../services/connection/plsqlSnapshotService";

function requirePlsqlTab(): string | null {
  const active = EditorService.getActiveTab();
  if (!active || !shouldUsePlsqlSave(active.uri)) {
    window.alert("This command is available on PL/SQL source tabs only.");
    return null;
  }
  return active.id;
}

CommandsRegistry.registerCommand("silk.plsql.snapshot.history", () => {
  const tabId = requirePlsqlTab();
  if (!tabId) return;
  try {
    openPlsqlSnapshotHistory(tabId);
  } catch (error) {
    window.alert(formatErrorMessage(error, "Failed to open snapshot history."));
  }
});

CommandsRegistry.registerCommand("silk.plsql.snapshot.take", () => {
  const tabId = requirePlsqlTab();
  if (!tabId) return;
  try {
    takeManualPlsqlSnapshot(tabId);
    window.alert("Snapshot saved locally.");
  } catch (error) {
    window.alert(formatErrorMessage(error, "Failed to take snapshot."));
  }
});

CommandsRegistry.registerCommand("silk.plsql.reloadFromDb", () => {
  const tabId = requirePlsqlTab();
  if (!tabId) return;
  try {
    openPlsqlReloadConfirm(tabId);
  } catch (error) {
    window.alert(formatErrorMessage(error, "Failed to prepare reload."));
  }
});

MenuRegistry.appendMenuItem(MenuId.MenubarTerminalMenu, {
  command: {
    id: "silk.plsql.snapshot.history",
    title: "PL/SQL Snapshot History",
  },
  group: "3_plsql",
  order: 10,
});

MenuRegistry.appendMenuItem(MenuId.MenubarTerminalMenu, {
  command: {
    id: "silk.plsql.snapshot.take",
    title: "Take PL/SQL Snapshot",
  },
  group: "3_plsql",
  order: 11,
});

MenuRegistry.appendMenuItem(MenuId.MenubarTerminalMenu, {
  command: {
    id: "silk.plsql.reloadFromDb",
    title: "Reload PL/SQL from Database",
  },
  group: "3_plsql",
  order: 12,
});
