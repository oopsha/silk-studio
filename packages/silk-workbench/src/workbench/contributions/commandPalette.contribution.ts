import { CommandsRegistry } from "../../platform/commands/commandRegistry";
import { CommandPaletteService } from "../../services/commands/commandPaletteService";

CommandsRegistry.registerCommand("workbench.action.showCommands", () => {
  CommandPaletteService.toggle();
});
