import { MenuId } from "../../platform/actions/menuId";
import { MenuRegistry } from "../../platform/actions/menuRegistry";
import { CommandsRegistry } from "../../platform/commands/commandRegistry";
import { AboutDialogService } from "../../services/diagnostics/aboutDialogService";
import { AppLogService } from "../../services/diagnostics/appLogService";
import {
  copyDiagnostics,
  openLogFolder,
} from "../../services/diagnostics/diagnosticsService";
import { DocumentationService } from "../../services/help/documentationService";
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

CommandsRegistry.registerCommand("silk.help.openDocumentation", () => {
  DocumentationService.openDocumentation();
});

MenuRegistry.appendMenuItem(MenuId.MenubarHelpMenu, {
  command: {
    id: "workbench.action.showCommands",
    title: {
      value: "Command Palette...",
      mnemonicTitle: "&&Command Palette...",
    },
  },
  group: "1_help",
  order: 1,
});

MenuRegistry.appendMenuItem(MenuId.MenubarHelpMenu, {
  command: {
    id: "workbench.action.openGlobalKeybindings",
    title: {
      value: "Keyboard Shortcuts",
      mnemonicTitle: "&&Keyboard Shortcuts",
    },
  },
  group: "1_help",
  order: 2,
});

MenuRegistry.appendMenuItem(MenuId.MenubarHelpMenu, {
  command: {
    id: "silk.help.openDocumentation",
    title: {
      value: "Documentation",
      mnemonicTitle: "&&Documentation",
    },
  },
  group: "1_help",
  order: 3,
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
