import { MenuId } from "@silk-studio/workbench/platform/actions/menuId.ts";
import { MenuRegistry } from "@silk-studio/workbench/platform/actions/menuRegistry.ts";
import { CommandsRegistry } from "@silk-studio/workbench/platform/commands/commandRegistry.ts";
import { KeybindingsRegistry } from "@silk-studio/workbench/platform/keybinding/keybindingRegistry.ts";
import { ConnectionService } from "../../services/connection/connectionService";
import { ConnectionTreeService } from "../../services/connection/connectionTreeService";
import { openObjectDdl } from "../../services/connection/ddlEditorService";
import {
  openDropObjectDialog,
  openRenameObjectDialog,
} from "../../services/connection/explorerObjectMutationService";
import { openPlsqlObjectSource } from "../../services/connection/plsqlEditorService";
import { ExplorerSearchQuickPickService } from "../../services/connection/explorerSearchQuickPickService";
import { ExplorerUiService } from "../../services/connection/explorerUiService";
import { openObjectEditor } from "../../services/connection/objectEditorService";
import {
  EXPLORER_COMMANDS,
  formatQualifiedName,
  type ExplorerObjectRef,
} from "../../services/connection/explorerObjectActions";

CommandsRegistry.registerCommand(
  EXPLORER_COMMANDS.openObjectEditor,
  async (...args: unknown[]) => {
    const target = args[0] as ExplorerObjectRef | undefined;
    if (!target) return;
    openObjectEditor(target);
  },
);

CommandsRegistry.registerCommand(
  EXPLORER_COMMANDS.viewDdl,
  async (...args: unknown[]) => {
    const target = args[0] as ExplorerObjectRef | undefined;
    if (!target) return;
    openObjectDdl(target);
  },
);

CommandsRegistry.registerCommand(
  EXPLORER_COMMANDS.openSource,
  async (...args: unknown[]) => {
    const target = args[0] as ExplorerObjectRef | undefined;
    if (!target) return;
    openPlsqlObjectSource(target);
  },
);

CommandsRegistry.registerCommand(
  EXPLORER_COMMANDS.openPackageBody,
  async (...args: unknown[]) => {
    const target = args[0] as ExplorerObjectRef | undefined;
    if (!target) return;
    openPlsqlObjectSource(target, { packageBody: true });
  },
);

CommandsRegistry.registerCommand(
  EXPLORER_COMMANDS.copyName,
  async (...args: unknown[]) => {
    const target = args[0] as ExplorerObjectRef | undefined;
    if (!target) return;
    const text = formatQualifiedName(target.schemaName, target.object.name);
    await navigator.clipboard.writeText(text);
  },
);

CommandsRegistry.registerCommand(
  EXPLORER_COMMANDS.refreshSchema,
  async (...args: unknown[]) => {
    const payload = args[0] as
      | { profileId: string; schemaName: string; catalogName?: string }
      | undefined;
    if (!payload?.profileId || !payload.schemaName) return;
    await ConnectionTreeService.invalidateAndRefreshSchema(
      payload.profileId,
      payload.schemaName,
      payload.catalogName,
    );
  },
);

CommandsRegistry.registerCommand(
  EXPLORER_COMMANDS.useDatabase,
  async (...args: unknown[]) => {
    const payload = args[0] as
      | { profileId: string; catalogName: string }
      | undefined;
    if (!payload?.profileId || !payload.catalogName) return;
    const { ActiveDatabaseService } = await import(
      "../../services/connection/activeDatabaseService"
    );
    await ActiveDatabaseService.useDatabase(
      payload.profileId,
      payload.catalogName,
    );
  },
);

CommandsRegistry.registerCommand(
  EXPLORER_COMMANDS.setDefaultDatabase,
  async (...args: unknown[]) => {
    const payload = args[0] as
      | { profileId: string; catalogName: string }
      | undefined;
    if (!payload?.profileId || !payload.catalogName) return;
    const { ActiveDatabaseService } = await import(
      "../../services/connection/activeDatabaseService"
    );
    await ActiveDatabaseService.setDefaultDatabase(
      payload.profileId,
      payload.catalogName,
    );
  },
);

CommandsRegistry.registerCommand(
  EXPLORER_COMMANDS.refreshCatalog,
  async (...args: unknown[]) => {
    const payload = args[0] as
      | { profileId: string; catalogName: string }
      | undefined;
    if (!payload?.profileId || !payload.catalogName) return;
    await ConnectionTreeService.loadCatalogSchemas(
      payload.profileId,
      payload.catalogName,
      true,
    );
  },
);

CommandsRegistry.registerCommand(
  EXPLORER_COMMANDS.dropObject,
  async (...args: unknown[]) => {
    const target = args[0] as ExplorerObjectRef | undefined;
    if (!target) return;
    openDropObjectDialog(target);
  },
);

CommandsRegistry.registerCommand(
  EXPLORER_COMMANDS.renameObject,
  async (...args: unknown[]) => {
    const target = args[0] as ExplorerObjectRef | undefined;
    if (!target) return;
    openRenameObjectDialog(target);
  },
);

CommandsRegistry.registerCommand(EXPLORER_COMMANDS.searchObjects, async () => {
  ExplorerSearchQuickPickService.show();
});

CommandsRegistry.registerCommand(EXPLORER_COMMANDS.refresh, async () => {
  const ids = ConnectionService.getState().connectedProfileIds;
  if (ids.length === 0) {
    throw new Error("Connect a database profile before refreshing.");
  }
  for (const profileId of ids) {
    await ConnectionTreeService.loadSchemas(profileId, true);
  }
});

CommandsRegistry.registerCommand(EXPLORER_COMMANDS.collapseAll, async () => {
  ExplorerUiService.collapseAll();
});

MenuRegistry.appendMenuItem(MenuId.MenubarViewMenu, {
  command: {
    id: EXPLORER_COMMANDS.searchObjects,
    title: "Search Database Objects…",
  },
  group: "3_explorer",
  order: 1,
});

MenuRegistry.appendMenuItem(MenuId.MenubarViewMenu, {
  command: {
    id: EXPLORER_COMMANDS.refresh,
    title: "Refresh Connections Explorer",
  },
  group: "3_explorer",
  order: 2,
});

MenuRegistry.appendMenuItem(MenuId.MenubarViewMenu, {
  command: {
    id: EXPLORER_COMMANDS.collapseAll,
    title: "Collapse Connections Explorer",
  },
  group: "3_explorer",
  order: 3,
});

KeybindingsRegistry.registerKeybinding(
  EXPLORER_COMMANDS.searchObjects,
  "Ctrl+Shift+O",
);
