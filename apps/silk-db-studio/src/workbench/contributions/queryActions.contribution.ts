import { MenuId } from "../../platform/actions/menuId";
import { MenuRegistry } from "../../platform/actions/menuRegistry";
import { CommandsRegistry } from "../../platform/commands/commandRegistry";
import { KeybindingsRegistry } from "../../platform/keybinding/keybindingRegistry";
import { EditorService } from "../../services/editor/editorService";
import { LayoutService } from "../../services/layout/layoutService";
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
