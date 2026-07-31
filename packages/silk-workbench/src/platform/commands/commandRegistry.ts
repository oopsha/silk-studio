import type { CommandHandler, ICommand } from "./types";

type CommandChangeListener = (commandId: string) => void;

class CommandRegistryImpl {
  private readonly commands = new Map<string, ICommand>();
  private readonly listeners = new Set<CommandChangeListener>();

  registerCommand(id: string, handler: CommandHandler): () => void {
    if (this.commands.has(id)) {
      console.warn(`Command '${id}' is already registered.`);
    }

    const command: ICommand = { id, handler };
    this.commands.set(id, command);
    this.fireDidRegisterCommand(id);

    return () => {
      if (this.commands.get(id) === command) {
        this.commands.delete(id);
      }
    };
  }

  getCommand(id: string): ICommand | undefined {
    return this.commands.get(id);
  }

  getCommands(): readonly ICommand[] {
    return [...this.commands.values()];
  }

  onDidRegisterCommand(listener: CommandChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private fireDidRegisterCommand(commandId: string): void {
    for (const listener of this.listeners) {
      listener(commandId);
    }
  }
}

export const CommandsRegistry = new CommandRegistryImpl();
