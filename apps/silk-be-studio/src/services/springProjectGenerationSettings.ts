export const OFFLINE_INDENT_SIZE_KEY = "silk.be.springProject.offlineIndentSize";
export const DEFAULT_OFFLINE_INDENT_SIZE = 4;

export function getOfflineIndentSize(): number {
  const stored = Number(localStorage.getItem(OFFLINE_INDENT_SIZE_KEY));
  return Number.isInteger(stored) && stored >= 1 && stored <= 8
    ? stored
    : DEFAULT_OFFLINE_INDENT_SIZE;
}

export function setOfflineIndentSize(size: number): void {
  if (!Number.isInteger(size) || size < 1 || size > 8) return;
  localStorage.setItem(OFFLINE_INDENT_SIZE_KEY, String(size));
}
