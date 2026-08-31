import { CommandsRegistry } from "../../platform/commands/commandRegistry";

CommandsRegistry.registerCommand("workbench.action.reloadWindow", () => {
  window.location.reload();
});
