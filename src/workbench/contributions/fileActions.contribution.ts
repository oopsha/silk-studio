import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { MenuId } from "../../platform/actions/menuId";
import { MenuRegistry } from "../../platform/actions/menuRegistry";
import { CommandsRegistry } from "../../platform/commands/commandRegistry";
import { KeybindingsRegistry } from "../../platform/keybinding/keybindingRegistry";

CommandsRegistry.registerCommand("silk.file.newTextFile", () => {
  console.log("[command] silk.file.newTextFile");
});

CommandsRegistry.registerCommand("silk.file.openFile", () => {
  console.log("[command] silk.file.openFile");
});

CommandsRegistry.registerCommand("silk.file.save", () => {
  console.log("[command] silk.file.save");
});

CommandsRegistry.registerCommand("silk.file.saveAs", () => {
  console.log("[command] silk.file.saveAs");
});

CommandsRegistry.registerCommand("silk.file.exit", async () => {
  if (isTauri()) {
    await getCurrentWindow().close();
  }
});

MenuRegistry.appendMenuItem(MenuId.MenubarFileMenu, {
  command: {
    id: "silk.file.newTextFile",
    title: { value: "New Text File", mnemonicTitle: "&&New Text File" },
  },
  group: "1_file",
  order: 10,
});

MenuRegistry.appendMenuItem(MenuId.MenubarFileMenu, {
  command: {
    id: "silk.file.openFile",
    title: { value: "Open File...", mnemonicTitle: "&&Open File..." },
  },
  group: "1_file",
  order: 20,
});

MenuRegistry.appendMenuItem(MenuId.MenubarFileMenu, {
  command: {
    id: "silk.file.save",
    title: { value: "Save", mnemonicTitle: "&&Save" },
  },
  group: "2_save",
  order: 10,
});

MenuRegistry.appendMenuItem(MenuId.MenubarFileMenu, {
  command: {
    id: "silk.file.saveAs",
    title: { value: "Save As...", mnemonicTitle: "Save &&As..." },
  },
  group: "2_save",
  order: 20,
});

MenuRegistry.appendMenuItem(MenuId.MenubarFileMenu, {
  command: {
    id: "silk.file.exit",
    title: { value: "Exit", mnemonicTitle: "E&&xit" },
  },
  group: "9_exit",
  order: 10,
});

KeybindingsRegistry.registerKeybinding("silk.file.newTextFile", "Ctrl+N");
KeybindingsRegistry.registerKeybinding("silk.file.openFile", "Ctrl+O");
KeybindingsRegistry.registerKeybinding("silk.file.save", "Ctrl+S");
KeybindingsRegistry.registerKeybinding("silk.file.saveAs", "Ctrl+Shift+S");
