import { MenuId } from "../../platform/actions/menuId";
import { MenuRegistry } from "../../platform/actions/menuRegistry";
import { CommandsRegistry } from "../../platform/commands/commandRegistry";
import { KeybindingsRegistry } from "../../platform/keybinding/keybindingRegistry";
import { LayoutService } from "../../services/layout/layoutService";

CommandsRegistry.registerCommand("workbench.action.toggleSidebarVisibility", () => {
  LayoutService.toggleSidebar();
});

CommandsRegistry.registerCommand("workbench.action.togglePanel", () => {
  LayoutService.togglePanel();
});

CommandsRegistry.registerCommand("workbench.action.toggleAuxiliaryBar", () => {
  LayoutService.toggleAuxiliaryBar();
});

CommandsRegistry.registerCommand("workbench.action.toggleMaximizedPanel", () => {
  LayoutService.togglePanelMaximized();
});

CommandsRegistry.registerCommand("workbench.action.togglePanelPosition", () => {
  LayoutService.togglePanelPosition();
});

CommandsRegistry.registerCommand("workbench.action.movePanelToBottom", () => {
  LayoutService.movePanelToBottom();
});

CommandsRegistry.registerCommand("workbench.action.movePanelToRight", () => {
  LayoutService.movePanelToRight();
});

MenuRegistry.appendMenuItem(MenuId.LayoutControlMenu, {
  command: {
    id: "workbench.action.toggleSidebarVisibility",
    title: "Toggle Primary Side Bar",
    icon: "layout-sidebar-left-off",
    toggled: {
      condition: "sideBarVisible",
      icon: "layout-sidebar-left",
    },
  },
  group: "navigation",
  order: 0,
  when: "config.workbench.layoutControl.enabled",
});

MenuRegistry.appendMenuItem(MenuId.LayoutControlMenu, {
  command: {
    id: "workbench.action.togglePanel",
    title: "Toggle Panel",
    icon: "layout-panel-off",
    toggled: {
      condition: "panelVisible",
      icon: "layout-panel",
    },
  },
  group: "navigation",
  order: 1,
  when: "config.workbench.layoutControl.enabled",
});

MenuRegistry.appendMenuItem(MenuId.LayoutControlMenu, {
  command: {
    id: "workbench.action.toggleAuxiliaryBar",
    title: "Toggle AI Chat",
    icon: "layout-sidebar-right-off",
    toggled: {
      condition: "auxiliaryBarVisible",
      icon: "layout-sidebar-right",
    },
  },
  group: "navigation",
  order: 2,
  when: "config.workbench.layoutControl.enabled",
});

MenuRegistry.appendMenuItem(MenuId.MenubarViewMenu, {
  command: {
    id: "workbench.action.toggleMaximizedPanel",
    title: { value: "Maximize Panel Size", mnemonicTitle: "Ma&&ximize Panel Size" },
  },
  group: "2_panel",
  order: 10,
});

MenuRegistry.appendMenuItem(MenuId.MenubarViewMenu, {
  command: {
    id: "workbench.action.movePanelToBottom",
    title: { value: "Move Panel To Bottom", mnemonicTitle: "Move Panel To &&Bottom" },
  },
  group: "2_panel",
  order: 20,
  when: "panelPositionRight",
});

MenuRegistry.appendMenuItem(MenuId.MenubarViewMenu, {
  command: {
    id: "workbench.action.movePanelToRight",
    title: { value: "Move Panel Right", mnemonicTitle: "Move Panel &&Right" },
  },
  group: "2_panel",
  order: 21,
  when: "panelPositionBottom",
});

MenuRegistry.appendMenuItem(MenuId.MenubarViewMenu, {
  command: {
    id: "workbench.action.togglePanelPosition",
    title: { value: "Toggle Panel Position", mnemonicTitle: "Toggle Panel &&Position" },
  },
  group: "2_panel",
  order: 22,
});

KeybindingsRegistry.registerKeybinding(
  "workbench.action.toggleMaximizedPanel",
  "Ctrl+Shift+J",
);
