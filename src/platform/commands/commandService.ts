import { CommandsRegistry } from "./commandRegistry";

class CommandServiceImpl {
  async executeCommand(commandId: string, ...args: unknown[]): Promise<void> {
    const command = CommandsRegistry.getCommand(commandId);
    if (!command) {
      console.warn(`Unknown command: ${commandId}`);
      return;
    }

    await command.handler(...args);
  }
}

export const CommandService = new CommandServiceImpl();
