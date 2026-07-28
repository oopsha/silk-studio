/**
 * Persists query-result grid column layout (width / order / hide / pin).
 *
 * Storage key strategy:
 *   `silk-db-studio.queryResult.columnLayout.v1:{profileId}:{columnSignature}`
 * where `columnSignature` is a short hash of the ordered column name list.
 * Same connection + same result columns → same layout.
 */

export type PersistedColumnLayoutItem = {
  colId: string;
  width?: number | null;
  flex?: number | null;
  hide?: boolean | null;
  pinned?: "left" | "right" | boolean | null;
};

export type PersistedColumnLayout = {
  version: 1;
  /** Ordered column names used to build the storage key (validation on load). */
  columns: string[];
  state: PersistedColumnLayoutItem[];
};

const STORAGE_PREFIX = "silk-db-studio.queryResult.columnLayout.v1";

export function buildColumnLayoutStorageKey(
  profileId: string | null | undefined,
  columns: string[],
): string {
  const profile = profileId && profileId.trim() ? profileId.trim() : "none";
  return `${STORAGE_PREFIX}:${profile}:${hashColumnSignature(columns)}`;
}

export function loadColumnLayout(
  profileId: string | null | undefined,
  columns: string[],
): PersistedColumnLayout | null {
  if (columns.length === 0) return null;
  try {
    const raw = localStorage.getItem(
      buildColumnLayoutStorageKey(profileId, columns),
    );
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    const layout = normalizeLayout(parsed);
    if (!layout) return null;
    if (!sameColumnSet(layout.columns, columns)) return null;
    return layout;
  } catch {
    return null;
  }
}

export function saveColumnLayout(
  profileId: string | null | undefined,
  columns: string[],
  state: PersistedColumnLayoutItem[],
): void {
  if (columns.length === 0 || state.length === 0) return;
  const payload: PersistedColumnLayout = {
    version: 1,
    columns: [...columns],
    state,
  };
  localStorage.setItem(
    buildColumnLayoutStorageKey(profileId, columns),
    JSON.stringify(payload),
  );
}

export function clearColumnLayout(
  profileId: string | null | undefined,
  columns: string[],
): void {
  if (columns.length === 0) return;
  localStorage.removeItem(buildColumnLayoutStorageKey(profileId, columns));
}

export function hasSavedColumnLayout(
  profileId: string | null | undefined,
  columns: string[],
): boolean {
  return loadColumnLayout(profileId, columns) !== null;
}

/** FNV-1a 32-bit hex — short, stable, good enough for localStorage keys. */
export function hashColumnSignature(columns: string[]): string {
  const input = columns.join("\u0001");
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function sameColumnSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  // Order-sensitive: SELECT a,b vs SELECT b,a are different layouts.
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function normalizeLayout(value: unknown): PersistedColumnLayout | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || !Array.isArray(record.columns) || !Array.isArray(record.state)) {
    return null;
  }
  const columns = record.columns.filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  );
  if (columns.length === 0) return null;

  const state: PersistedColumnLayoutItem[] = [];
  for (const item of record.state) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    if (typeof entry.colId !== "string" || !entry.colId) continue;
    state.push({
      colId: entry.colId,
      width: asNumberOrNull(entry.width),
      flex: asNumberOrNull(entry.flex),
      hide: typeof entry.hide === "boolean" ? entry.hide : entry.hide === null ? null : undefined,
      pinned: normalizePinned(entry.pinned),
    });
  }
  if (state.length === 0) return null;
  return { version: 1, columns, state };
}

function asNumberOrNull(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizePinned(
  value: unknown,
): PersistedColumnLayoutItem["pinned"] {
  if (value === undefined) return undefined;
  if (value === null || value === false) return null;
  if (value === "left" || value === "right" || value === true) return value;
  return undefined;
}
