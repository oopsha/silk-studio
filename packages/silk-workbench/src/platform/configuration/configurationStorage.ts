import type { WorkbenchConfiguration } from "./configurationDefaults";

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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(configuration));
  } catch {
    // Ignore quota or private-mode errors.
  }
}
