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

export function saveConfiguration(
  configuration: WorkbenchConfiguration,
): void {
  try {
    const payload: Record<string, unknown> = {};
    for (const key of Object.keys(CONFIGURATION_DEFAULTS) as ConfigurationKey[]) {
      payload[key] = configuration[key];
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore quota or private-mode errors.
  }
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
