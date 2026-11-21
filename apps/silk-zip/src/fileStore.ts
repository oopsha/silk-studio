import { invoke, isTauri } from "@tauri-apps/api/core";

/**
 * Small persisted values (settings, recent lists). The desktop app keeps each one in its own JSON
 * file in the app data folder; a plain browser keeps it in localStorage, which also serves as the
 * migration source the first time the desktop app runs.
 */

/** The browser copy of a value, or null when there is none or storage is unavailable. */
export function readBrowserCopy(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Saves `text` as the value called `name` (file in the desktop app, `key` in a browser). */
export function writeStored(name: string, key: string, text: string): void {
  const saveToBrowser = () => {
    try {
      localStorage.setItem(key, text);
    } catch {
      // The value still applies for this session when storage is unavailable.
    }
  };
  if (isTauri()) void invoke("settings_save", { name, text }).catch(saveToBrowser);
  else saveToBrowser();
}

/**
 * Desktop app: loads the file and hands its text to `apply`; when no file exists yet, writes the
 * browser copy (`current`) into it instead. Failures keep the browser copy.
 */
export async function syncStored(name: string, current: () => string | null, apply: (text: string) => void): Promise<void> {
  if (!isTauri()) return;
  try {
    const text = await invoke<string | null>("settings_load", { name });
    if (text === null) {
      const copy = current();
      if (copy !== null) await invoke("settings_save", { name, text: copy });
      return;
    }
    apply(text);
  } catch {
    // Keep the values read from the browser copy.
  }
}
