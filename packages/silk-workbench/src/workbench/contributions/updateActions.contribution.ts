import { CommandsRegistry } from "../../platform/commands/commandRegistry";
import { checkForUpdates } from "../../services/updates/updateService";

CommandsRegistry.registerCommand("update.check", () => {
  void checkForUpdates();
});
