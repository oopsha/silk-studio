import { MenuId } from "../../platform/actions/menuId";
import { MenuRegistry } from "../../platform/actions/menuRegistry";
import { CommandsRegistry } from "../../platform/commands/commandRegistry";

CommandsRegistry.registerCommand("silk.selection.selectAll", () => {
  console.log("[command] silk.selection.selectAll");
});

CommandsRegistry.registerCommand("silk.selection.expandSelection", () => {
  console.log("[command] silk.selection.expandSelection");
});

MenuRegistry.appendMenuItem(MenuId.MenubarSelectionMenu, {
  command: {
    id: "silk.selection.selectAll",
    title: { value: "Select All", mnemonicTitle: "Select &&All" },
  },
  group: "1_selection",
  order: 10,
});

MenuRegistry.appendMenuItem(MenuId.MenubarSelectionMenu, {
  command: {
    id: "silk.selection.expandSelection",
    title: {
      value: "Expand Selection",
      mnemonicTitle: "E&&xpand Selection",
    },
  },
  group: "1_selection",
  order: 20,
});
