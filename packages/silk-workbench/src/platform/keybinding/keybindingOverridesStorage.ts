export type KeybindingOverride = {
  commandId: string;
  /** Full replacement set of key labels for this command; empty means "unbound". */
  keys: string[];
};

const STORAGE_KEY = "silk-workbench.keybindingOverrides";

export function loadKeybindingOverrides(): KeybindingOverride[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is KeybindingOverride =>
        item &&
        typeof item === "object" &&
        typeof item.commandId === "string" &&
        Array.isArray(item.keys) &&
        item.keys.every((key: unknown) => typeof key === "string"),
    );
  } catch {
    return [];
  }
}

export function saveKeybindingOverrides(overrides: KeybindingOverride[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // Ignore quota or private-mode errors.
  }
}
