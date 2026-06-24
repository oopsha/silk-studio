import { MenuId } from "../../platform/actions/menuId";
import { MenuRegistry } from "../../platform/actions/menuRegistry";
import { CommandsRegistry } from "../../platform/commands/commandRegistry";

CommandsRegistry.registerCommand("silk.help.about", () => {
  console.log("[command] silk.help.about — silk-editor");
});

MenuRegistry.appendMenuItem(MenuId.MenubarHelpMenu, {
  command: {
    id: "silk.help.about",
    title: { value: "About", mnemonicTitle: "&&About" },
  },
  group: "1_help",
  order: 10,
});
