import { CommandsRegistry } from "@silk-studio/workbench/platform/commands/commandRegistry.ts";
import { AppNotificationService } from "@silk-studio/workbench/services/notifications/appNotificationService.ts";
import { exportSettings, importSettings } from "../../services/settings/settingsExportService";
import { formatErrorMessage } from "../../services/formatErrorMessage";

CommandsRegistry.registerCommand("silk.settings.export", async () => {
  try {
    const ok = await exportSettings();
    if (ok) AppNotificationService.show("Settings exported.", "success");
  } catch (error) {
    AppNotificationService.show(
      formatErrorMessage(error, "Failed to export settings."),
      "error",
    );
  }
});

CommandsRegistry.registerCommand("silk.settings.import", async () => {
  try {
    const ok = await importSettings();
    if (ok) AppNotificationService.show("Settings imported.", "success");
  } catch (error) {
    AppNotificationService.show(
      formatErrorMessage(error, "Failed to import settings."),
      "error",
    );
  }
});
