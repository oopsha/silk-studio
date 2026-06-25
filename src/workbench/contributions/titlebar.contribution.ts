import { MenuId } from "../../platform/actions/menuId";
import { MenuRegistry } from "../../platform/actions/menuRegistry";
import { CommandsRegistry } from "../../platform/commands/commandRegistry";
import { HistoryService } from "../../services/history/historyService";
import { WindowTitleService } from "../../services/windowTitle/windowTitleService";

HistoryService.seed({ label: WindowTitleService.getWorkspaceName() });

CommandsRegistry.registerCommand("workbench.action.quickOpen", () => {
  console.log("[command] workbench.action.quickOpen");
});

MenuRegistry.appendMenuItem(MenuId.CommandCenter, {
  command: {
    id: "workbench.action.navigateBack",
    title: "Go Back",
    icon: "arrow-left",
  },
  order: 1,
  when: "config.workbench.navigationControl.enabled",
});

MenuRegistry.appendMenuItem(MenuId.CommandCenter, {
  command: {
    id: "workbench.action.navigateForward",
    title: "Go Forward",
    icon: "arrow-right",
  },
  order: 2,
  when: "config.workbench.navigationControl.enabled",
});

MenuRegistry.appendMenuItem(MenuId.CommandCenter, {
  submenu: MenuId.CommandCenterCenter,
  title: "",
  order: 101,
});

MenuRegistry.appendMenuItem(MenuId.CommandCenterCenter, {
  command: {
    id: "workbench.action.quickOpen",
    title: "Search",
  },
  order: 1,
});
