import type { MessageKey } from "../i18n/translate";

export type CommandHandler = (...args: unknown[]) => void | Promise<void>;

export interface ICommand {
  id: string;
  handler: CommandHandler;
  titleKey?: MessageKey;
}
