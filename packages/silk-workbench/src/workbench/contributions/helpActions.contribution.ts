import { MenuId } from "../../platform/actions/menuId";
import { MenuRegistry } from "../../platform/actions/menuRegistry";
import { CommandsRegistry } from "../../platform/commands/commandRegistry";
import { AboutDialogService } from "../../services/diagnostics/aboutDialogService";
import { AppLogService } from "../../services/diagnostics/appLogService";
import {
  copyDiagnostics,
  openLogFolder,
} from "../../services/diagnostics/diagnosticsService";
import { AppNotificationService } from "../../services/notifications/appNotificationService";

CommandsRegistry.registerCommand("silk.help.about", () => {
  AboutDialogService.show();
});

CommandsRegistry.registerCommand("silk.help.copyDiagnostics", async () => {
  try {
    await copyDiagnostics();
    AppNotificationService.show("Diagnostics copied to clipboard.", "success");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to copy diagnostics.";
    void AppLogService.error(message, "silk.help.copyDiagnostics");
    AppNotificationService.show(message, "error");
  }
});

CommandsRegistry.registerCommand("silk.help.openLogFolder", async () => {
  try {
    await openLogFolder();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to open log folder.";
    void AppLogService.error(message, "silk.help.openLogFolder");
    AppNotificationService.show(message, "error");
  }
});

MenuRegistry.appendMenuItem(MenuId.MenubarHelpMenu, {
  command: {
    id: "silk.help.about",
    title: { value: "About", mnemonicTitle: "&&About" },
  },
  group: "1_help",
  order: 10,
});

MenuRegistry.appendMenuItem(MenuId.MenubarHelpMenu, {
  command: {
    id: "silk.help.copyDiagnostics",
    title: {
      value: "Copy Diagnostics",
      mnemonicTitle: "Copy &&Diagnostics",
    },
  },
  group: "2_diagnostics",
  order: 10,
});

MenuRegistry.appendMenuItem(MenuId.MenubarHelpMenu, {
  command: {
    id: "silk.help.openLogFolder",
    title: {
      value: "Open Log Folder",
      mnemonicTitle: "Open &&Log Folder",
    },
  },
  group: "2_diagnostics",
  order: 20,
});
