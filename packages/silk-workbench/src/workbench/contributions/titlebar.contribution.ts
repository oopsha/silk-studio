import { MenuId } from "../../platform/actions/menuId";
import { MenuRegistry } from "../../platform/actions/menuRegistry";
import { CommandsRegistry } from "../../platform/commands/commandRegistry";
import { KeybindingsRegistry } from "../../platform/keybinding/keybindingRegistry";
import { HistoryService } from "@silk-studio/editor/services/history/historyService.ts";
import { TabBarActionService } from "@silk-studio/editor/services/editor/tabBarActionService.ts";
import { WindowTitleService } from "../../services/windowTitle/windowTitleService";

HistoryService.seed({ label: WindowTitleService.getWorkspaceName() });

// Silk has no workspace file tree to search — "Go to File" doesn't apply. The closest
// equivalent to VS Code's Quick Open (Ctrl+P) is switching between already-open tabs, so this
// reuses the same picker workbench.action.showAllEditors opens (see editorActions.contribution.ts).
CommandsRegistry.registerCommand("workbench.action.quickOpen", () => {
  TabBarActionService.requestShowOpenEditors();
});

KeybindingsRegistry.registerKeybinding("workbench.action.quickOpen", "Ctrl+P");

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
