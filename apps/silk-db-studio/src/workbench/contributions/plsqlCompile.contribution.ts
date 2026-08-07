import { MenuId } from "@silk-studio/workbench/platform/actions/menuId.ts";
import { MenuRegistry } from "@silk-studio/workbench/platform/actions/menuRegistry.ts";
import { CommandsRegistry } from "@silk-studio/workbench/platform/commands/commandRegistry.ts";
import { KeybindingsRegistry } from "@silk-studio/workbench/platform/keybinding/keybindingRegistry.ts";
import { formatErrorMessage } from "../../services/formatErrorMessage";
import { compileActivePlsqlObject } from "../../services/connection/plsqlCompileService";
import { shouldUsePlsqlSave } from "../../services/connection/plsqlSaveService";
import { EditorService } from "@silk-studio/editor/services/editor/editorServiceFacade.ts";

CommandsRegistry.registerCommand("silk.plsql.compile", async () => {
  const active = EditorService.getActiveTab();
  if (!active || !shouldUsePlsqlSave(active.uri)) {
    window.alert("Compile is available on PL/SQL source tabs only.");
    return;
  }
  try {
    await compileActivePlsqlObject(active.id);
  } catch (error) {
    window.alert(formatErrorMessage(error, "Failed to compile PL/SQL object."));
  }
});

MenuRegistry.appendMenuItem(MenuId.MenubarTerminalMenu, {
  command: {
    id: "silk.plsql.compile",
    title: "Compile PL/SQL",
  },
  group: "2_run",
  order: 20,
});

KeybindingsRegistry.registerKeybinding("silk.plsql.compile", "Ctrl+Shift+F9");
