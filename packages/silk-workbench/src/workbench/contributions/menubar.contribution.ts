import { MenuId } from "../../platform/actions/menuId";
import { MenuRegistry } from "../../platform/actions/menuRegistry";

MenuRegistry.appendMenuItem(MenuId.MenubarMainMenu, {
  submenu: MenuId.MenubarFileMenu,
  title: {
    value: "File",
    mnemonicTitle: "&&File",
  },
  order: 1,
});

MenuRegistry.appendMenuItem(MenuId.MenubarMainMenu, {
  submenu: MenuId.MenubarEditMenu,
  title: {
    value: "Edit",
    mnemonicTitle: "&&Edit",
  },
  order: 2,
});

MenuRegistry.appendMenuItem(MenuId.MenubarMainMenu, {
  submenu: MenuId.MenubarSelectionMenu,
  title: {
    value: "Selection",
    mnemonicTitle: "&&Selection",
  },
  order: 3,
});

MenuRegistry.appendMenuItem(MenuId.MenubarMainMenu, {
  submenu: MenuId.MenubarViewMenu,
  title: {
    value: "View",
    mnemonicTitle: "&&View",
  },
  order: 4,
});

MenuRegistry.appendMenuItem(MenuId.MenubarMainMenu, {
  submenu: MenuId.MenubarGoMenu,
  title: {
    value: "Go",
    mnemonicTitle: "&&Go",
  },
  order: 5,
});

MenuRegistry.appendMenuItem(MenuId.MenubarMainMenu, {
  submenu: MenuId.MenubarTerminalMenu,
  title: {
    value: "Terminal",
    mnemonicTitle: "&&Terminal",
  },
  order: 7,
});

MenuRegistry.appendMenuItem(MenuId.MenubarMainMenu, {
  submenu: MenuId.MenubarHelpMenu,
  title: {
    value: "Help",
    mnemonicTitle: "&&Help",
  },
  order: 8,
});
