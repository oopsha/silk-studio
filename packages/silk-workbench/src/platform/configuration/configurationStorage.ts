import { readBrowserCopy, syncStored, writeStored } from "../../services/storage/fileStore";
import {
  CONFIGURATION_DEFAULTS,
  type ConfigurationKey,
  type WorkbenchConfiguration,
} from "./configurationDefaults";

const STORAGE_KEY = "silk-workbench.configuration";

export function loadConfiguration(): Partial<WorkbenchConfiguration> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Partial<WorkbenchConfiguration>;
  } catch {
    return null;
  }
}

/**
 * The desktop app keeps the configuration in its own file; localStorage then only mirrors it so the
 * next start can apply the saved theme before the file has been read.
 */
export function saveConfiguration(
  configuration: WorkbenchConfiguration,
): void {
  const payload: Record<string, unknown> = {};
  for (const key of Object.keys(CONFIGURATION_DEFAULTS) as ConfigurationKey[]) {
    payload[key] = configuration[key];
  }
  writeStored("configuration", STORAGE_KEY, JSON.stringify(payload), { cache: true });
}

/** Desktop app: loads the configuration file (first run: writes the localStorage copy into it). */
export function syncConfigurationFile(apply: (stored: Partial<WorkbenchConfiguration> | null) => void): void {
  void syncStored("configuration", () => readBrowserCopy(STORAGE_KEY), (text) => {
    try {
      apply(JSON.parse(text) as Partial<WorkbenchConfiguration>);
    } catch {
      // Keep the values read from localStorage.
    }
  });
}

/**
 * Pre-8-A plaintext API keys lived in configuration localStorage.
 * Returns the legacy value once so it can be moved to the OS keyring.
 */
export function extractLegacyAiApiKey(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed["ai.apiKey"] !== "string") return null;
    const key = parsed["ai.apiKey"].trim();
    return key.length > 0 ? key : null;
  } catch {
    return null;
  }
}
