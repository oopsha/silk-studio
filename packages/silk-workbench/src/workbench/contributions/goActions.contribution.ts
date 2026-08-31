import { MenuId } from "../../platform/actions/menuId";
import { MenuRegistry } from "../../platform/actions/menuRegistry";
import { CommandsRegistry } from "../../platform/commands/commandRegistry";
import { KeybindingsRegistry } from "../../platform/keybinding/keybindingRegistry";
import { HistoryService } from "@silk-studio/editor/services/history/historyService.ts";
import { EditorService } from "@silk-studio/editor/services/editor/editorServiceFacade.ts";

CommandsRegistry.registerCommand("workbench.action.navigateBack", () => {
  HistoryService.goBack();
});

CommandsRegistry.registerCommand("workbench.action.navigateForward", () => {
  HistoryService.goForward();
});

CommandsRegistry.registerCommand("workbench.action.gotoLine", () => {
  EditorService.getActiveTextEditor()?.getAction("editor.action.gotoLine")?.run();
});

MenuRegistry.appendMenuItem(MenuId.MenubarGoMenu, {
  command: {
    id: "workbench.action.navigateBack",
    title: { value: "Back", mnemonicTitle: "&&Back" },
  },
  group: "1_navigation",
  order: 10,
});

MenuRegistry.appendMenuItem(MenuId.MenubarGoMenu, {
  command: {
    id: "workbench.action.navigateForward",
    title: { value: "Forward", mnemonicTitle: "&&Forward" },
  },
  group: "1_navigation",
  order: 20,
});

MenuRegistry.appendMenuItem(MenuId.MenubarGoMenu, {
  command: {
    id: "workbench.action.gotoLine",
    title: { value: "Go to Line/Column...", mnemonicTitle: "Go to &&Line/Column..." },
  },
  group: "2_symbol",
  order: 10,
});

KeybindingsRegistry.registerKeybinding(
  "workbench.action.navigateBack",
  "Alt+Left",
);
KeybindingsRegistry.registerKeybinding(
  "workbench.action.navigateForward",
  "Alt+Right",
);
KeybindingsRegistry.registerKeybinding("workbench.action.gotoLine", "Ctrl+G");
