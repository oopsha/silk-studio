import { MenuId } from "@silk-studio/workbench/platform/actions/menuId.ts";
import { MenuRegistry } from "@silk-studio/workbench/platform/actions/menuRegistry.ts";
import { CommandsRegistry } from "@silk-studio/workbench/platform/commands/commandRegistry.ts";
import { ContextKeyService } from "@silk-studio/workbench/platform/context/contextKeyService.ts";
import { AppNotificationService } from "@silk-studio/workbench/services/notifications/appNotificationService.ts";
import { ConnectionEditorService } from "../../services/connection/connectionEditorService";
import { ConnectionService } from "../../services/connection/connectionService";
import { ConnectionTreeService } from "../../services/connection/connectionTreeService";
import { ConfirmDialogService } from "../../services/ui/confirmDialogService";
import {
  exportConnectionProfiles,
  importConnectionProfiles,
} from "../../services/connection/connectionExportService";
import { ConnectionExportDialogService } from "../../services/connection/connectionExportDialogService";
import { formatErrorMessage } from "../../services/formatErrorMessage";

function updateConnectionContextKeys(): void {
  const profile = ConnectionService.getActiveProfile();
  const connected = Boolean(profile && ConnectionService.isConnected(profile.id));
  ContextKeyService.set("canConnect", Boolean(profile) && !connected);
  ContextKeyService.set("canDisconnect", connected);
  ContextKeyService.set(
    "hasConnectedProfiles",
    ConnectionService.getConnectedProfiles().length > 0,
  );
  ContextKeyService.set("hasActiveConnectionProfile", Boolean(profile));
  ContextKeyService.set(
    "hasConnectionProfiles",
    ConnectionService.getState().profiles.length > 0,
  );
}

ConnectionService.onDidChange(updateConnectionContextKeys);
updateConnectionContextKeys();

CommandsRegistry.registerCommand("silk.connection.new", () => {
  ConnectionEditorService.openNewConnection();
});

CommandsRegistry.registerCommand("silk.connection.connect", async () => {
  const profile = ConnectionService.getActiveProfile();
  if (!profile) return;
  await ConnectionService.connect(profile.id);
});

CommandsRegistry.registerCommand("silk.connection.disconnect", async () => {
  const profile = ConnectionService.getActiveProfile();
  if (!profile || !ConnectionService.isConnected(profile.id)) return;
  await ConnectionService.disconnect(profile.id);
});

CommandsRegistry.registerCommand("silk.connection.disconnectAll", async () => {
  for (const profile of ConnectionService.getConnectedProfiles()) {
    await ConnectionService.disconnect(profile.id);
  }
});

CommandsRegistry.registerCommand("silk.connection.edit", () => {
  const profile = ConnectionService.getActiveProfile();
  if (!profile) return;
  ConnectionEditorService.openConnection(profile.id);
});

CommandsRegistry.registerCommand("silk.connection.duplicate", async () => {
  const profile = ConnectionService.getActiveProfile();
  if (!profile) return;
  const duplicate = await ConnectionService.duplicateProfile(profile.id);
  ConnectionEditorService.openConnection(duplicate.id);
});

CommandsRegistry.registerCommand("silk.connection.delete", async () => {
  const profile = ConnectionService.getActiveProfile();
  if (!profile) return;
  const confirmed = await ConfirmDialogService.confirm({
    title: "Delete Connection",
    message: `Delete "${profile.name}"? This cannot be undone.`,
    confirmLabel: "Delete",
    danger: true,
  });
  if (!confirmed) return;
  await ConnectionService.deleteProfile(profile.id);
});

CommandsRegistry.registerCommand("silk.connection.refreshSchema", async () => {
  const profile = ConnectionService.getActiveProfile();
  if (!profile || !ConnectionService.isConnected(profile.id)) return;
  await ConnectionTreeService.loadSchemas(profile.id, true);
  AppNotificationService.show(`"${profile.name}" refreshed.`, "success");
});

CommandsRegistry.registerCommand("silk.connection.exportAll", async () => {
  const profiles = ConnectionService.getState().profiles;
  const result = await ConnectionExportDialogService.open(
    profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      driverId: profile.driverId,
    })),
  );
  if (!result.confirmed) return;

  try {
    const ok = await exportConnectionProfiles(result.profileIds);
    if (ok) AppNotificationService.show("Connections exported.", "success");
  } catch (error) {
    AppNotificationService.show(
      formatErrorMessage(error, "Failed to export connections."),
      "error",
    );
  }
});

CommandsRegistry.registerCommand("silk.connection.import", async () => {
  try {
    const result = await importConnectionProfiles();
    if (!result) return;
    AppNotificationService.show(
      result.skipped > 0
        ? `Imported ${result.imported}, skipped ${result.skipped}.`
        : `Imported ${result.imported} connection(s).`,
      result.imported > 0 ? "success" : "info",
    );
  } catch (error) {
    AppNotificationService.show(
      formatErrorMessage(error, "Failed to import connections."),
      "error",
    );
  }
});

MenuRegistry.appendMenuItem(MenuId.MenubarConnectionMenu, {
  command: {
    id: "silk.connection.new",
    title: "New Connection",
  },
  group: "1_new",
  order: 10,
});

MenuRegistry.appendMenuItem(MenuId.MenubarConnectionMenu, {
  command: {
    id: "silk.connection.connect",
    title: "Connect",
  },
  group: "2_state",
  order: 20,
});

MenuRegistry.appendMenuItem(MenuId.MenubarConnectionMenu, {
  command: {
    id: "silk.connection.disconnect",
    title: "Disconnect",
  },
  group: "2_state",
  order: 21,
});

MenuRegistry.appendMenuItem(MenuId.MenubarConnectionMenu, {
  command: {
    id: "silk.connection.disconnectAll",
    title: "Disconnect All",
  },
  group: "2_state",
  order: 22,
});

MenuRegistry.appendMenuItem(MenuId.MenubarConnectionMenu, {
  command: {
    id: "silk.connection.edit",
    title: "Edit Connection...",
  },
  group: "3_manage",
  order: 30,
});

MenuRegistry.appendMenuItem(MenuId.MenubarConnectionMenu, {
  command: {
    id: "silk.connection.duplicate",
    title: "Duplicate Connection",
  },
  group: "3_manage",
  order: 31,
});

MenuRegistry.appendMenuItem(MenuId.MenubarConnectionMenu, {
  command: {
    id: "silk.connection.delete",
    title: "Delete Connection...",
  },
  group: "3_manage",
  order: 32,
});

MenuRegistry.appendMenuItem(MenuId.MenubarConnectionMenu, {
  command: {
    id: "silk.connection.refreshSchema",
    title: "Refresh Schema/Catalog",
  },
  group: "3_manage",
  order: 33,
});

MenuRegistry.appendMenuItem(MenuId.MenubarConnectionMenu, {
  command: {
    id: "silk.connection.exportAll",
    title: "Export Connections...",
  },
  group: "4_data",
  order: 40,
});

MenuRegistry.appendMenuItem(MenuId.MenubarConnectionMenu, {
  command: {
    id: "silk.connection.import",
    title: "Import Connections...",
  },
  group: "4_data",
  order: 41,
});
