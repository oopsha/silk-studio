import type { QueryFavorite, QueryHistoryEntry } from "./queryHistoryTypes";

const HISTORY_KEY = "silk-db-studio.query.history";
const FAVORITES_KEY = "silk-db-studio.query.favorites";

export const MAX_QUERY_HISTORY = 100;

export function loadQueryHistory(): QueryHistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeHistoryEntry)
      .filter((entry): entry is QueryHistoryEntry => entry !== null);
  } catch {
    return [];
  }
}

export function saveQueryHistory(entries: QueryHistoryEntry[]): void {
  localStorage.setItem(
    HISTORY_KEY,
    JSON.stringify(entries.slice(0, MAX_QUERY_HISTORY)),
  );
}

export function loadQueryFavorites(): QueryFavorite[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeFavorite)
      .filter((entry): entry is QueryFavorite => entry !== null);
  } catch {
    return [];
  }
}

export function saveQueryFavorites(favorites: QueryFavorite[]): void {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
}

function normalizeHistoryEntry(value: unknown): QueryHistoryEntry | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    typeof record.sql !== "string" ||
    (record.status !== "success" &&
      record.status !== "error" &&
      record.status !== "cancelled") ||
    typeof record.executedAt !== "number" ||
    typeof record.durationMs !== "number" ||
    typeof record.summary !== "string"
  ) {
    return null;
  }

  return {
    id: record.id,
    sql: record.sql,
    status: record.status,
    executedAt: record.executedAt,
    durationMs: Math.max(0, record.durationMs),
    connectionProfileId:
      typeof record.connectionProfileId === "string"
        ? record.connectionProfileId
        : null,
    connectionName:
      typeof record.connectionName === "string" ? record.connectionName : null,
    driverId: typeof record.driverId === "string" ? record.driverId : null,
    summary: record.summary,
  };
}

function normalizeFavorite(value: unknown): QueryFavorite | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    typeof record.name !== "string" ||
    typeof record.sql !== "string" ||
    typeof record.createdAt !== "number" ||
    typeof record.updatedAt !== "number"
  ) {
    return null;
  }

  return {
    id: record.id,
    name: record.name,
    sql: record.sql,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
