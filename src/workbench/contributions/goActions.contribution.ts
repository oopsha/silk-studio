import { MenuId } from "../../platform/actions/menuId";
import { MenuRegistry } from "../../platform/actions/menuRegistry";
import { CommandsRegistry } from "../../platform/commands/commandRegistry";
import { KeybindingsRegistry } from "../../platform/keybinding/keybindingRegistry";
import { HistoryService } from "../../services/history/historyService";

CommandsRegistry.registerCommand("workbench.action.navigateBack", () => {
  HistoryService.goBack();
});

CommandsRegistry.registerCommand("workbench.action.navigateForward", () => {
  HistoryService.goForward();
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

KeybindingsRegistry.registerKeybinding(
  "workbench.action.navigateBack",
  "Alt+Left",
);
KeybindingsRegistry.registerKeybinding(
  "workbench.action.navigateForward",
  "Alt+Right",
);
