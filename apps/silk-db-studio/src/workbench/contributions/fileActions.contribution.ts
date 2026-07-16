import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { MenuId } from "../../platform/actions/menuId";
import { MenuRegistry } from "../../platform/actions/menuRegistry";
import { CommandsRegistry } from "../../platform/commands/commandRegistry";

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
