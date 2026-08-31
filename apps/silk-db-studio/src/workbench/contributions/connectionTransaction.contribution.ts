import { MenuId } from "@silk-studio/workbench/platform/actions/menuId.ts";
import { MenuRegistry } from "@silk-studio/workbench/platform/actions/menuRegistry.ts";
import { CommandsRegistry } from "@silk-studio/workbench/platform/commands/commandRegistry.ts";
import { EditorConnectionBindingService } from "../../services/connection/editorConnectionBindingService";
import {
  commitConnection,
  rollbackConnection,
} from "../../services/connection/connectionTransactionService";

CommandsRegistry.registerCommand("silk.connection.commit", async () => {
  const { profileId } = EditorConnectionBindingService.getActiveBinding();
  if (!profileId) return;
  await commitConnection(profileId);
});

CommandsRegistry.registerCommand("silk.connection.rollback", async () => {
  const { profileId } = EditorConnectionBindingService.getActiveBinding();
  if (!profileId) return;
  await rollbackConnection(profileId);
});

MenuRegistry.appendMenuItem(MenuId.MenubarRunMenu, {
  command: {
    id: "silk.connection.commit",
    title: "Commit",
  },
  group: "2_txn",
  order: 41,
});

MenuRegistry.appendMenuItem(MenuId.MenubarRunMenu, {
  command: {
    id: "silk.connection.rollback",
    title: "Rollback",
  },
  group: "2_txn",
  order: 42,
});
