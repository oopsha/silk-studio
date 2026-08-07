import { MenuId } from "@silk-studio/workbench/platform/actions/menuId.ts";
import { MenuRegistry } from "@silk-studio/workbench/platform/actions/menuRegistry.ts";
import { CommandsRegistry } from "@silk-studio/workbench/platform/commands/commandRegistry.ts";
import { ViewService } from "@silk-studio/workbench/services/view/viewService.ts";
import { QueryFavoritesService } from "../../services/query/queryFavoritesService";
import { QueryHistoryService } from "../../services/query/queryHistoryService";
import { EditorService } from "@silk-studio/editor/services/editor/editorServiceFacade.ts";
import {
  insertSqlIntoActiveEditor,
  openSqlInEditor,
  reexecuteSql,
} from "../../services/query/querySqlActions";

CommandsRegistry.registerCommand("silk.query.openHistory", () => {
  ViewService.openView("history");
});

CommandsRegistry.registerCommand("silk.query.clearHistory", () => {
  if (QueryHistoryService.getEntries().length === 0) return;
  if (window.confirm("Clear all query history?")) {
    QueryHistoryService.clear();
  }
});

CommandsRegistry.registerCommand("silk.query.addFavoriteFromEditor", () => {
  const tab = EditorService.getActiveTab();
  if (!tab || !tab.content.trim()) return;
  const suggested =
    tab.content.split(/\r?\n/, 1)[0]?.trim().slice(0, 48) || "Favorite query";
  const name = window.prompt("Favorite name", suggested);
  if (name === null) return;
  QueryFavoritesService.add(name.trim() || suggested, tab.content);
  ViewService.openView("history");
});

CommandsRegistry.registerCommand(
  "silk.query.reexecuteLastHistory",
  async () => {
    const latest = QueryHistoryService.getEntries()[0];
    if (!latest) return;
    await reexecuteSql(latest.sql);
  },
);

CommandsRegistry.registerCommand("silk.query.openLastHistoryInEditor", () => {
  const latest = QueryHistoryService.getEntries()[0];
  if (!latest) return;
  openSqlInEditor(latest.sql);
});

CommandsRegistry.registerCommand("silk.query.insertLastHistory", () => {
  const latest = QueryHistoryService.getEntries()[0];
  if (!latest) return;
  insertSqlIntoActiveEditor(latest.sql);
});

MenuRegistry.appendMenuItem(MenuId.MenubarTerminalMenu, {
  command: {
    id: "silk.query.openHistory",
    title: "Query History",
  },
  group: "3_history",
  order: 10,
});

MenuRegistry.appendMenuItem(MenuId.MenubarTerminalMenu, {
  command: {
    id: "silk.query.addFavoriteFromEditor",
    title: "Add Editor SQL to Favorites",
  },
  group: "3_history",
  order: 20,
});

MenuRegistry.appendMenuItem(MenuId.MenubarTerminalMenu, {
  command: {
    id: "silk.query.clearHistory",
    title: "Clear Query History",
  },
  group: "3_history",
  order: 30,
});
