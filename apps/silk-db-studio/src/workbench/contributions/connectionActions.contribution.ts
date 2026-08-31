import { MenuId } from "@silk-studio/workbench/platform/actions/menuId.ts";
import { MenuRegistry } from "@silk-studio/workbench/platform/actions/menuRegistry.ts";
import { CommandsRegistry } from "@silk-studio/workbench/platform/commands/commandRegistry.ts";
import { ContextKeyService } from "@silk-studio/workbench/platform/context/contextKeyService.ts";
import { ConnectionEditorService } from "../../services/connection/connectionEditorService";
import { ConnectionService } from "../../services/connection/connectionService";

function updateConnectionContextKeys(): void {
  const profile = ConnectionService.getActiveProfile();
  const connected = Boolean(profile && ConnectionService.isConnected(profile.id));
  ContextKeyService.set("canConnect", Boolean(profile) && !connected);
  ContextKeyService.set("canDisconnect", connected);
  ContextKeyService.set(
    "hasConnectedProfiles",
    ConnectionService.getConnectedProfiles().length > 0,
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
