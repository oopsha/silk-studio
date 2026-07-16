import { MenuId } from "@silk-studio/workbench/platform/actions/menuId.ts";
import { MenuRegistry } from "@silk-studio/workbench/platform/actions/menuRegistry.ts";
import { CommandsRegistry } from "@silk-studio/workbench/platform/commands/commandRegistry.ts";
import { KeybindingsRegistry } from "@silk-studio/workbench/platform/keybinding/keybindingRegistry.ts";
import { EditorService } from "@silk-studio/editor/services/editor/editorService.ts";
import { LayoutService } from "@silk-studio/workbench/services/layout/layoutService.ts";
import { QueryExecutionService } from "../../services/query/queryExecutionService";

CommandsRegistry.registerCommand("silk.query.execute", async () => {
  const active = EditorService.getActiveTab();
  if (!active) return;

  LayoutService.showPanel();
  await QueryExecutionService.execute(active.content);
});

MenuRegistry.appendMenuItem(MenuId.MenubarTerminalMenu, {
  command: {
    id: "silk.query.execute",
    title: "Run Query",
  },
  group: "2_run",
  order: 15,
});

KeybindingsRegistry.registerKeybinding("silk.query.execute", "Ctrl+Enter");
