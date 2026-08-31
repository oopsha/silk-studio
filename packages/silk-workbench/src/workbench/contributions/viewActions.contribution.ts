import { MenuId } from "../../platform/actions/menuId";
import { MenuRegistry } from "../../platform/actions/menuRegistry";
import { CommandsRegistry } from "../../platform/commands/commandRegistry";
import { KeybindingsRegistry } from "../../platform/keybinding/keybindingRegistry";

import { ViewService } from "../../services/view/viewService";

CommandsRegistry.registerCommand("silk.view.explorer", () => {
  ViewService.openView("explorer");
});

CommandsRegistry.registerCommand("silk.view.search", () => {
  ViewService.openView("search");
});

CommandsRegistry.registerCommand("silk.view.history", () => {
  ViewService.openView("history");
});

MenuRegistry.appendMenuItem(MenuId.MenubarViewMenu, {
  command: {
    id: "silk.view.explorer",
    title: { value: "Explorer", mnemonicTitle: "E&&xplorer" },
  },
  group: "1_views",
  order: 10,
});

MenuRegistry.appendMenuItem(MenuId.MenubarViewMenu, {
  command: {
    id: "silk.view.search",
    title: { value: "Search", mnemonicTitle: "&&Search" },
  },
  group: "1_views",
  order: 12,
});

MenuRegistry.appendMenuItem(MenuId.MenubarViewMenu, {
  command: {
    id: "silk.view.history",
    title: { value: "Query History", mnemonicTitle: "Query &&History" },
  },
  group: "1_views",
  order: 15,
});

KeybindingsRegistry.registerKeybinding("silk.view.explorer", "Ctrl+Shift+E");
KeybindingsRegistry.registerKeybinding("silk.view.search", "Ctrl+Shift+F");
KeybindingsRegistry.registerKeybinding("silk.view.history", "Ctrl+Shift+H");
