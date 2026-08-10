import { MenuId } from "@silk-studio/workbench/platform/actions/menuId.ts";
import { MenuRegistry } from "@silk-studio/workbench/platform/actions/menuRegistry.ts";
import { CommandsRegistry } from "@silk-studio/workbench/platform/commands/commandRegistry.ts";
import { KeybindingsRegistry } from "@silk-studio/workbench/platform/keybinding/keybindingRegistry.ts";
import { EditorService } from "@silk-studio/editor/services/editor/editorServiceFacade.ts";
import { EditorGroupsService } from "@silk-studio/editor/services/editor/editorGroupsService.ts";
import type { EditorGroupId } from "@silk-studio/editor/services/editor/editorGroupTypes.ts";
import { GroupPanelStateService } from "@silk-studio/workbench/services/layout/groupPanelStateService.ts";
import { QueryExecutionService } from "../../services/query/queryExecutionService";
import {
  extractExecutableSql,
  extractExecutableStatements,
} from "../../services/query/sqlExecutable";
import { extractExecutableScript } from "../../services/query/sqlScriptBatches";
import { resolveActiveDriverId } from "../../services/sql/sqlDialect";

CommandsRegistry.registerCommand("silk.query.execute", async () => {
  const snapshot = EditorService.getActiveEditorSnapshot();
  if (!snapshot) return;

  const { statements } = extractExecutableStatements(
    snapshot.content,
    snapshot.selectionStart,
    snapshot.selectionEnd,
  );

  GroupPanelStateService.showPanel(EditorGroupsService.getFocusedGroupId());
  await QueryExecutionService.executeStatements(statements);
  EditorService.getActiveTextEditor()?.focus();
});

CommandsRegistry.registerCommand("silk.query.executeScript", async () => {
  const snapshot = EditorService.getActiveEditorSnapshot();
  if (!snapshot) return;

  const driverId = resolveActiveDriverId();
  const { statements } = extractExecutableScript(
    snapshot.content,
    snapshot.selectionStart,
    snapshot.selectionEnd,
    driverId,
  );

  GroupPanelStateService.showPanel(EditorGroupsService.getFocusedGroupId());
  await QueryExecutionService.executeScript(statements);
  EditorService.getActiveTextEditor()?.focus();
});

/** @deprecated Prefer silk.query.executeScript — kept as an alias for old bindings. */
CommandsRegistry.registerCommand("silk.query.executeAll", async () => {
  const command = CommandsRegistry.getCommand("silk.query.executeScript");
  if (command) {
    await command.handler();
  }
});

CommandsRegistry.registerCommand("silk.query.explain", async () => {
  const snapshot = EditorService.getActiveEditorSnapshot();
  if (!snapshot) return;

  const { sql, range } = extractExecutableSql(
    snapshot.content,
    snapshot.selectionStart,
    snapshot.selectionEnd,
  );

  GroupPanelStateService.showPanel(EditorGroupsService.getFocusedGroupId());
  await QueryExecutionService.explain(sql, { sourceRange: range });
  EditorService.getActiveTextEditor()?.focus();
});

CommandsRegistry.registerCommand("silk.query.cancel", async (...args: unknown[]) => {
  const groupId = (args[0] as EditorGroupId | undefined) ?? EditorGroupsService.getFocusedGroupId();
  await QueryExecutionService.cancel(groupId);
});

MenuRegistry.appendMenuItem(MenuId.MenubarTerminalMenu, {
  command: {
    id: "silk.query.execute",
    title: "Run Statement",
  },
  group: "2_run",
  order: 15,
});

MenuRegistry.appendMenuItem(MenuId.MenubarTerminalMenu, {
  command: {
    id: "silk.query.executeScript",
    title: "Execute Script",
  },
  group: "2_run",
  order: 16,
});

MenuRegistry.appendMenuItem(MenuId.MenubarTerminalMenu, {
  command: {
    id: "silk.query.explain",
    title: "Explain Plan",
  },
  group: "2_run",
  order: 17,
});

MenuRegistry.appendMenuItem(MenuId.MenubarTerminalMenu, {
  command: {
    id: "silk.query.cancel",
    title: "Cancel Query",
  },
  group: "2_run",
  order: 18,
});

KeybindingsRegistry.registerKeybinding("silk.query.execute", "Ctrl+Enter");
KeybindingsRegistry.registerKeybinding(
  "silk.query.executeScript",
  "Ctrl+Shift+Enter",
);
KeybindingsRegistry.registerKeybinding(
  "silk.query.explain",
  "Ctrl+Shift+E",
);
