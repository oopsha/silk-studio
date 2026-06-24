import { MenuId } from "../../platform/actions/menuId";
import { MenuRegistry } from "../../platform/actions/menuRegistry";
import { CommandsRegistry } from "../../platform/commands/commandRegistry";
import { KeybindingsRegistry } from "../../platform/keybinding/keybindingRegistry";

CommandsRegistry.registerCommand("silk.terminal.new", () => {
  console.log("[command] silk.terminal.new");
});

MenuRegistry.appendMenuItem(MenuId.MenubarTerminalMenu, {
  command: {
    id: "silk.terminal.new",
    title: { value: "New Terminal", mnemonicTitle: "&&New Terminal" },
  },
  group: "1_terminal",
  order: 10,
});

KeybindingsRegistry.registerKeybinding("silk.terminal.new", "Ctrl+Shift+`");
