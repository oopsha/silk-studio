export type CommandHandler = (...args: unknown[]) => void | Promise<void>;

export interface ICommand {
  id: string;
  handler: CommandHandler;
}
