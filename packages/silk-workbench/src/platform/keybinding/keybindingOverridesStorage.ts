import { readBrowserCopy, syncStored, writeStored } from "../../services/storage/fileStore";

export type KeybindingOverride = {
  commandId: string;
  /** Full replacement set of key labels for this command; empty means "unbound". */
  keys: string[];
};

const STORAGE_KEY = "silk-workbench.keybindingOverrides";

function parseOverrides(raw: string | null): KeybindingOverride[] {
  try {
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

/** Overrides read from the browser copy (synchronous, so the keys work from the first keypress). */
export function loadKeybindingOverrides(): KeybindingOverride[] {
  return parseOverrides(readBrowserCopy(STORAGE_KEY));
}

/** Saved to the app's file; localStorage mirrors it for the next start. */
export function saveKeybindingOverrides(overrides: KeybindingOverride[]): void {
  writeStored("keybindings", STORAGE_KEY, JSON.stringify(overrides), { cache: true });
}

/** Desktop app: hands over the overrides saved in the file (first run: writes the browser copy into it). */
export function syncKeybindingOverrides(apply: (overrides: KeybindingOverride[]) => void): void {
  void syncStored("keybindings", () => readBrowserCopy(STORAGE_KEY), (text) => apply(parseOverrides(text)));
}
