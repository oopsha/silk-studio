import { MenuId } from "@silk-studio/workbench/platform/actions/menuId.ts";
import { MenuRegistry } from "@silk-studio/workbench/platform/actions/menuRegistry.ts";
import { CommandsRegistry } from "@silk-studio/workbench/platform/commands/commandRegistry.ts";
import { KeybindingsRegistry } from "@silk-studio/workbench/platform/keybinding/keybindingRegistry.ts";
import { EditorService } from "@silk-studio/editor/services/editor/editorService.ts";
import { LayoutService } from "@silk-studio/workbench/services/layout/layoutService.ts";
import { QueryExecutionService } from "../../services/query/queryExecutionService";
import {
  extractExecutableSql,
  extractExecutableStatements,
  statementsInRange,
} from "../../services/query/sqlExecutable";

CommandsRegistry.registerCommand("silk.query.execute", async () => {
  const snapshot = EditorService.getActiveEditorSnapshot();
  if (!snapshot) return;

  const { statements } = extractExecutableStatements(
    snapshot.content,
    snapshot.selectionStart,
    snapshot.selectionEnd,
  );

  LayoutService.showPanel();
  await QueryExecutionService.executeStatements(statements);
});

CommandsRegistry.registerCommand("silk.query.executeAll", async () => {
  const active = EditorService.getActiveTab();
  if (!active) return;

  const statements = statementsInRange(active.content, 0, active.content.length);

  LayoutService.showPanel();
  await QueryExecutionService.executeStatements(statements);
});

CommandsRegistry.registerCommand("silk.query.explain", async () => {
  const snapshot = EditorService.getActiveEditorSnapshot();
  if (!snapshot) return;

  const { sql, range } = extractExecutableSql(
    snapshot.content,
    snapshot.selectionStart,
    snapshot.selectionEnd,
  );

  LayoutService.showPanel();
  await QueryExecutionService.explain(sql, { sourceRange: range });
});

CommandsRegistry.registerCommand("silk.query.cancel", async () => {
  await QueryExecutionService.cancel();
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
    id: "silk.query.executeAll",
    title: "Run All",
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
  "silk.query.executeAll",
  "Ctrl+Shift+Enter",
);
KeybindingsRegistry.registerKeybinding(
  "silk.query.explain",
  "Ctrl+Shift+E",
);
