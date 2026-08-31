import { MenuId } from "@silk-studio/workbench/platform/actions/menuId.ts";
import { MenuRegistry } from "@silk-studio/workbench/platform/actions/menuRegistry.ts";
import { CommandsRegistry } from "@silk-studio/workbench/platform/commands/commandRegistry.ts";
import { KeybindingsRegistry } from "@silk-studio/workbench/platform/keybinding/keybindingRegistry.ts";
import { QueryResultGridService } from "../../services/query/queryResultGridService";

CommandsRegistry.registerCommand("silk.queryResult.copySelection", async () => {
  if (!QueryResultGridService.isAttached()) return;
  try {
    await QueryResultGridService.copy("selection");
  } catch (error) {
    console.warn("[silk.queryResult.copySelection] failed", error);
  }
});

CommandsRegistry.registerCommand("silk.queryResult.copyRows", async () => {
  if (!QueryResultGridService.isAttached()) return;
  try {
    await QueryResultGridService.copy("rows");
  } catch (error) {
    console.warn("[silk.queryResult.copyRows] failed", error);
  }
});

CommandsRegistry.registerCommand("silk.queryResult.copyAll", async () => {
  if (!QueryResultGridService.isAttached()) return;
  try {
    await QueryResultGridService.copy("all");
  } catch (error) {
    console.warn("[silk.queryResult.copyAll] failed", error);
  }
});

CommandsRegistry.registerCommand("silk.queryResult.exportCsv", async () => {
  if (!QueryResultGridService.isAttached()) return;
  try {
    await QueryResultGridService.exportCsv();
  } catch (error) {
    console.warn("[silk.queryResult.exportCsv] failed", error);
  }
});

CommandsRegistry.registerCommand("silk.queryResult.clearFilters", () => {
  if (!QueryResultGridService.isAttached()) return;
  QueryResultGridService.clearFiltersAndSort();
});

CommandsRegistry.registerCommand("silk.queryResult.saveColumnLayout", () => {
  if (!QueryResultGridService.isAttached()) return;
  QueryResultGridService.saveColumnLayoutNow();
});

CommandsRegistry.registerCommand("silk.queryResult.resetColumnLayout", () => {
  if (!QueryResultGridService.isAttached()) return;
  QueryResultGridService.resetColumnLayout();
});

MenuRegistry.appendMenuItem(MenuId.MenubarRunMenu, {
  command: {
    id: "silk.queryResult.copySelection",
    title: "Copy Selection",
  },
  group: "6_result",
  order: 80,
});

MenuRegistry.appendMenuItem(MenuId.MenubarRunMenu, {
  command: {
    id: "silk.queryResult.copyRows",
    title: "Copy Selected Rows",
  },
  group: "6_result",
  order: 81,
});

MenuRegistry.appendMenuItem(MenuId.MenubarRunMenu, {
  command: {
    id: "silk.queryResult.copyAll",
    title: "Copy All Filtered Rows",
  },
  group: "6_result",
  order: 82,
});

MenuRegistry.appendMenuItem(MenuId.MenubarRunMenu, {
  command: {
    id: "silk.queryResult.exportCsv",
    title: "Export CSV (Filtered)",
  },
  group: "6_result",
  order: 83,
});

MenuRegistry.appendMenuItem(MenuId.MenubarRunMenu, {
  command: {
    id: "silk.queryResult.clearFilters",
    title: "Clear Result Filters",
  },
  group: "6_result",
  order: 84,
});

MenuRegistry.appendMenuItem(MenuId.MenubarRunMenu, {
  command: {
    id: "silk.queryResult.saveColumnLayout",
    title: "Save Column Layout",
  },
  group: "6_result",
  order: 85,
});

MenuRegistry.appendMenuItem(MenuId.MenubarRunMenu, {
  command: {
    id: "silk.queryResult.resetColumnLayout",
    title: "Reset Column Layout",
  },
  group: "6_result",
  order: 86,
});

KeybindingsRegistry.registerKeybinding(
  "silk.queryResult.copyAll",
  "Ctrl+Shift+C",
);
KeybindingsRegistry.registerKeybinding(
  "silk.queryResult.exportCsv",
  "Ctrl+Shift+S",
);
