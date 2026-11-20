import { CommandsRegistry } from "../../platform/commands/commandRegistry";
import { MenuRegistry } from "../../platform/actions/menuRegistry";
import { KeybindingsRegistry } from "../../platform/keybinding/keybindingRegistry";
import { resolveCommandDisplayLabel } from "./commandDisplayLabel";

export type CommandPaletteItem = {
  id: string;
  label: string;
  keybinding?: string;
};

const hiddenCommandIds = new Set<string>();

/** Keeps helper commands (aliases, placeholders) out of the palette; apps call this at startup. */
export function hideCommandsFromPalette(...commandIds: string[]): void {
  for (const id of commandIds) hiddenCommandIds.add(id);
}

/** Build searchable command rows from the registry + menu titles. */
export function listCommandPaletteItems(): CommandPaletteItem[] {
  const menuTitles = MenuRegistry.collectCommandTitles();
  const items: CommandPaletteItem[] = [];

  for (const command of CommandsRegistry.getCommands()) {
    if (hiddenCommandIds.has(command.id)) continue;
    items.push({
      id: command.id,
      label: resolveCommandDisplayLabel(command.id, menuTitles),
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
