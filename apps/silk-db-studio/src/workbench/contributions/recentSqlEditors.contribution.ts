import { MenuId } from "@silk-studio/workbench/platform/actions/menuId.ts";
import { MenuRegistry } from "@silk-studio/workbench/platform/actions/menuRegistry.ts";
import { CommandsRegistry } from "@silk-studio/workbench/platform/commands/commandRegistry.ts";
import { ContextKeyService } from "@silk-studio/workbench/platform/context/contextKeyService.ts";
import { MAX_RECENT_SQL_EDITORS, RecentSqlEditorsService } from "../../services/editor/recentSqlEditorsService";

ContextKeyService.set("hasNoRecentSqlEditors", true);

for (let index = 0; index < MAX_RECENT_SQL_EDITORS; index += 1) {
  const slot = index;
  CommandsRegistry.registerCommand(`silk.recentSql.open.${slot}`, () =>
    RecentSqlEditorsService.open(slot),
  );
  CommandsRegistry.registerCommand(`silk.recentSql.remove.${slot}`, () =>
    RecentSqlEditorsService.remove(slot),
  );
}

CommandsRegistry.registerCommand("silk.recentSql.clear", () =>
  RecentSqlEditorsService.clear(),
);
CommandsRegistry.registerCommand("silk.recentSql.noItems", () => undefined);

MenuRegistry.appendMenuItem(MenuId.MenubarRecentSqlEditorsMenu, {
  command: {
    id: "silk.recentSql.noItems",
    title: "No recent SQL editors",
  },
  group: "1_recent",
  order: 1,
  when: "hasNoRecentSqlEditors",
});
