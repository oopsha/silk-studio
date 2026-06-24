import { MenuId } from "../../platform/actions/menuId";
import { MenuRegistry } from "../../platform/actions/menuRegistry";
import { CommandsRegistry } from "../../platform/commands/commandRegistry";
import { KeybindingsRegistry } from "../../platform/keybinding/keybindingRegistry";

CommandsRegistry.registerCommand("silk.go.back", () => {
  console.log("[command] silk.go.back");
});

CommandsRegistry.registerCommand("silk.go.forward", () => {
  console.log("[command] silk.go.forward");
});

MenuRegistry.appendMenuItem(MenuId.MenubarGoMenu, {
  command: {
    id: "silk.go.back",
    title: { value: "Back", mnemonicTitle: "&&Back" },
  },
  group: "1_navigation",
  order: 10,
});

MenuRegistry.appendMenuItem(MenuId.MenubarGoMenu, {
  command: {
    id: "silk.go.forward",
    title: { value: "Forward", mnemonicTitle: "&&Forward" },
  },
  group: "1_navigation",
  order: 20,
});

KeybindingsRegistry.registerKeybinding("silk.go.back", "Alt+Left");
KeybindingsRegistry.registerKeybinding("silk.go.forward", "Alt+Right");
