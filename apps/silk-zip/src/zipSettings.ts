import { useSyncExternalStore } from "react";

/** How "압축 풀기" picks its destination when no folder is chosen explicitly. */
export type ExtractDefaultTarget = "ask" | "named" | "here";

export interface ZipSettings {
  extractTarget: ExtractDefaultTarget;
  /** Replace files that already exist in the destination instead of skipping them. */
  overwrite: boolean;
  /** Open the destination folder once extraction finishes. */
  openFolderAfter: boolean;
}

const STORAGE_KEY = "silkZip.settings";
const DEFAULTS: ZipSettings = { extractTarget: "ask", overwrite: false, openFolderAfter: false };

function load(): ZipSettings {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    const value = (stored && typeof stored === "object" ? stored : {}) as Partial<ZipSettings>;
    return {
      extractTarget: value.extractTarget === "named" || value.extractTarget === "here" ? value.extractTarget : DEFAULTS.extractTarget,
      overwrite: typeof value.overwrite === "boolean" ? value.overwrite : DEFAULTS.overwrite,
      openFolderAfter: typeof value.openFolderAfter === "boolean" ? value.openFolderAfter : DEFAULTS.openFolderAfter,
    };
  } catch {
    return DEFAULTS;
  }
}

let current = load();
const listeners = new Set<() => void>();

export function getZipSettings(): ZipSettings {
  return current;
}

export function updateZipSettings(patch: Partial<ZipSettings>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Settings still apply for this session when storage is unavailable.
  }
  listeners.forEach((listener) => listener());
}

export function useZipSettings(): ZipSettings {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    getZipSettings,
  );
}

// The settings page replaces the workbench area while it is open.
let settingsOpen = false;
const viewListeners = new Set<() => void>();

export function setSettingsViewOpen(open: boolean): void {
  if (settingsOpen === open) return;
  settingsOpen = open;
  viewListeners.forEach((listener) => listener());
}

export function useSettingsViewOpen(): boolean {
  return useSyncExternalStore(
    (listener) => { viewListeners.add(listener); return () => viewListeners.delete(listener); },
    () => settingsOpen,
  );
}
