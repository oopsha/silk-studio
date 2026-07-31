import { CommandsRegistry } from "../../platform/commands/commandRegistry";
import { MenuRegistry } from "../../platform/actions/menuRegistry";
import { KeybindingsRegistry } from "../../platform/keybinding/keybindingRegistry";

export type CommandPaletteItem = {
  id: string;
  label: string;
  keybinding?: string;
};

function fallbackLabel(commandId: string): string {
  const leaf = commandId.split(".").pop() ?? commandId;
  return leaf
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

/** Build searchable command rows from the registry + menu titles. */
export function listCommandPaletteItems(): CommandPaletteItem[] {
  const titles = MenuRegistry.collectCommandTitles();
  const items: CommandPaletteItem[] = [];

  for (const command of CommandsRegistry.getCommands()) {
    items.push({
      id: command.id,
      label: titles.get(command.id) ?? fallbackLabel(command.id),
      keybinding: KeybindingsRegistry.lookupKeybinding(command.id),
    });
  }

  return items.sort((a, b) => a.label.localeCompare(b.label));
}

export function filterCommandPaletteItems(
  items: CommandPaletteItem[],
  query: string,
): CommandPaletteItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter(
    (item) =>
      item.label.toLowerCase().includes(q) ||
      item.id.toLowerCase().includes(q) ||
      (item.keybinding?.toLowerCase().includes(q) ?? false),
  );
}
