import { MenuId } from "../../platform/actions/menuId";
import { MenuRegistry } from "../../platform/actions/menuRegistry";
import { CommandsRegistry } from "../../platform/commands/commandRegistry";
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
    title: "Toggle Secondary Side Bar",
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
