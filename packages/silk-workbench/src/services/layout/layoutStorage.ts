import type { LayoutState } from "./layoutService";

const STORAGE_KEY = "silk-workbench.layout";

export function loadLayoutState(): Partial<LayoutState> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Partial<LayoutState>;
  } catch {
    return null;
  }
}

export function saveLayoutState(state: LayoutState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore quota or private-mode errors.
  }
}
