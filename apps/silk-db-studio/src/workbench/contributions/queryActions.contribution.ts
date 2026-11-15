import { MenuId } from "@silk-studio/workbench/platform/actions/menuId.ts";
import { MenuRegistry } from "@silk-studio/workbench/platform/actions/menuRegistry.ts";
import { CommandsRegistry } from "@silk-studio/workbench/platform/commands/commandRegistry.ts";
import { KeybindingsRegistry } from "@silk-studio/workbench/platform/keybinding/keybindingRegistry.ts";
import { ContextKeyService } from "@silk-studio/workbench/platform/context/contextKeyService.ts";
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
import { ConnectionTargetQuickPickService } from "../../services/connection/connectionTargetQuickPickService";
import { EditorConnectionBindingService } from "../../services/connection/editorConnectionBindingService";

let choosingExecutionConnection = false;

/** Resume only for the tab that requested the picker; closing it without a target cancels. */
async function selectExecutionConnection(): Promise<boolean> {
  if (choosingExecutionConnection) return false;
  if (EditorConnectionBindingService.getActiveBinding().profileId) return true;
  const tabId = EditorService.getActiveTab()?.id;
  if (!tabId) return false;
  choosingExecutionConnection = true;
  try {
    await new Promise<void>((resolve) => {
      const unsubscribe = ConnectionTargetQuickPickService.onDidChange(() => {
        if (ConnectionTargetQuickPickService.isOpen()) return;
        unsubscribe();
        resolve();
      });
      ConnectionTargetQuickPickService.show();
    });
    return EditorService.getActiveTab()?.id === tabId
      && Boolean(EditorConnectionBindingService.getActiveBinding().profileId);
  } finally {
    choosingExecutionConnection = false;
  }
}

function updateCancelQueryContextKey(): void {
  const groupId = EditorGroupsService.getFocusedGroupId();
  ContextKeyService.set("canCancelQuery", QueryExecutionService.isRunning(groupId));
}

QueryExecutionService.onDidChange(updateCancelQueryContextKey);
EditorGroupsService.onDidChangeAnyGroup(updateCancelQueryContextKey);
updateCancelQueryContextKey();

CommandsRegistry.registerCommand("silk.query.execute", async () => {
  if (!await selectExecutionConnection()) return;
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
  if (!await selectExecutionConnection()) return;
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

MenuRegistry.appendMenuItem(MenuId.MenubarRunMenu, {
  command: {
    id: "silk.query.execute",
    title: "Run Statement",
  },
  group: "1_run",
  order: 10,
});

MenuRegistry.appendMenuItem(MenuId.MenubarRunMenu, {
  command: {
    id: "silk.query.executeScript",
    title: "Execute Script",
  },
  group: "1_run",
  order: 20,
});

MenuRegistry.appendMenuItem(MenuId.MenubarRunMenu, {
  command: {
    id: "silk.query.explain",
    title: "Explain Plan",
  },
  group: "1_run",
  order: 30,
});

MenuRegistry.appendMenuItem(MenuId.MenubarRunMenu, {
  command: {
    id: "silk.query.cancel",
    title: "Cancel Query",
  },
  group: "1_run",
  order: 40,
});

KeybindingsRegistry.registerKeybinding("silk.query.execute", "Ctrl+Enter");
KeybindingsRegistry.registerKeybinding(
  "silk.query.executeScript",
  "Ctrl+Shift+Enter",
);
// Was Ctrl+Shift+E, which silently collided with silk.view.explorer (View > Explorer) —
// the registry has no per-context scoping, so two commands sharing one chord means neither
// fires. Ctrl+Alt+E is free.
KeybindingsRegistry.registerKeybinding(
  "silk.query.explain",
  "Ctrl+Alt+E",
);
