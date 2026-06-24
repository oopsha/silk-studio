import { MenuId } from "../../platform/actions/menuId";
import { MenuRegistry } from "../../platform/actions/menuRegistry";
import { CommandsRegistry } from "../../platform/commands/commandRegistry";
import { KeybindingsRegistry } from "../../platform/keybinding/keybindingRegistry";

CommandsRegistry.registerCommand("silk.edit.undo", () => {
  console.log("[command] silk.edit.undo");
});

CommandsRegistry.registerCommand("silk.edit.redo", () => {
  console.log("[command] silk.edit.redo");
});

CommandsRegistry.registerCommand("silk.edit.cut", () => {
  console.log("[command] silk.edit.cut");
});

CommandsRegistry.registerCommand("silk.edit.copy", () => {
  console.log("[command] silk.edit.copy");
});

CommandsRegistry.registerCommand("silk.edit.paste", () => {
  console.log("[command] silk.edit.paste");
});

MenuRegistry.appendMenuItem(MenuId.MenubarEditMenu, {
  command: {
    id: "silk.edit.undo",
    title: { value: "Undo", mnemonicTitle: "&&Undo" },
  },
  group: "1_undo",
  order: 10,
});

MenuRegistry.appendMenuItem(MenuId.MenubarEditMenu, {
  command: {
    id: "silk.edit.redo",
    title: { value: "Redo", mnemonicTitle: "&&Redo" },
  },
  group: "1_undo",
  order: 20,
});

MenuRegistry.appendMenuItem(MenuId.MenubarEditMenu, {
  command: {
    id: "silk.edit.cut",
    title: { value: "Cut", mnemonicTitle: "Cu&&t" },
  },
  group: "2_clipboard",
  order: 10,
});

MenuRegistry.appendMenuItem(MenuId.MenubarEditMenu, {
  command: {
    id: "silk.edit.copy",
    title: { value: "Copy", mnemonicTitle: "&&Copy" },
  },
  group: "2_clipboard",
  order: 20,
});

MenuRegistry.appendMenuItem(MenuId.MenubarEditMenu, {
  command: {
    id: "silk.edit.paste",
    title: { value: "Paste", mnemonicTitle: "&&Paste" },
  },
  group: "2_clipboard",
  order: 30,
});

KeybindingsRegistry.registerKeybinding("silk.edit.undo", "Ctrl+Z");
KeybindingsRegistry.registerKeybinding("silk.edit.redo", "Ctrl+Y");
KeybindingsRegistry.registerKeybinding("silk.edit.cut", "Ctrl+X");
KeybindingsRegistry.registerKeybinding("silk.edit.copy", "Ctrl+C");
KeybindingsRegistry.registerKeybinding("silk.edit.paste", "Ctrl+V");
