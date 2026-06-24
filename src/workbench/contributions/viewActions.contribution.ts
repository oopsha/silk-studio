import { MenuId } from "../../platform/actions/menuId";
import { MenuRegistry } from "../../platform/actions/menuRegistry";
import { CommandsRegistry } from "../../platform/commands/commandRegistry";
import { KeybindingsRegistry } from "../../platform/keybinding/keybindingRegistry";

CommandsRegistry.registerCommand("silk.view.explorer", () => {
  console.log("[command] silk.view.explorer");
});

CommandsRegistry.registerCommand("silk.view.terminal", () => {
  console.log("[command] silk.view.terminal");
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
    id: "silk.view.terminal",
    title: { value: "Terminal", mnemonicTitle: "&&Terminal" },
  },
  group: "1_views",
  order: 20,
});

KeybindingsRegistry.registerKeybinding("silk.view.explorer", "Ctrl+Shift+E");
KeybindingsRegistry.registerKeybinding("silk.view.terminal", "Ctrl+`");
