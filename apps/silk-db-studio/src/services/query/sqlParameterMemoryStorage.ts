import type { SqlParameterField, SqlParameterValue } from "./sqlParameters";
import { parameterValueKey } from "./sqlParameters";

const STORAGE_KEY = "silk-db-studio.sql.parameterMemory.v1";
const MAX_ENTRIES = 500;

type StoredEntry = {
  isNull: boolean;
  value: string;
  updatedAt: number;
};

type StoredMemory = Record<string, StoredEntry>;

/** Compact fingerprint for anonymous-parameter scoping (per statement). */
export function fingerprintSql(sql: string): string {
  const normalized = sql.replace(/\s+/g, " ").trim();
  let hash = 5381;
  for (let i = 0; i < normalized.length; i += 1) {
    hash = ((hash << 5) + hash) ^ normalized.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Hybrid persistence key:
 * - named → global by name
 * - anonymous → scoped by SQL fingerprint + index
 */
export function parameterMemoryKey(
  field: Pick<SqlParameterField, "kind" | "key">,
  sqlFingerprint: string | null,
): string {
  if (field.kind === "named") {
    return `named:${field.key.toLowerCase()}`;
  }
  const scope = sqlFingerprint && sqlFingerprint.length > 0 ? sqlFingerprint : "_";
  return `anon:${scope}:${field.key}`;
}

function loadRaw(): StoredMemory {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: StoredMemory = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const record = value as Record<string, unknown>;
      if (typeof record.isNull !== "boolean" || typeof record.value !== "string") {
        continue;
      }
      out[key] = {
        isNull: record.isNull,
        value: record.value,
        updatedAt:
          typeof record.updatedAt === "number" ? record.updatedAt : Date.now(),
      };
    }
    return out;
  } catch {
    return {};
  }
}

function saveRaw(memory: StoredMemory): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(memory));
  } catch {
    // Quota / private mode — ignore.
  }
}

function prune(memory: StoredMemory): StoredMemory {
  const entries = Object.entries(memory);
  if (entries.length <= MAX_ENTRIES) return memory;
  entries.sort((a, b) => b[1].updatedAt - a[1].updatedAt);
  const next: StoredMemory = {};
  for (const [key, value] of entries.slice(0, MAX_ENTRIES)) {
    next[key] = value;
  }
  return next;
}

export function loadRememberedParameterValues(
  fields: readonly SqlParameterField[],
  sqlFingerprint: string | null,
): Map<string, SqlParameterValue> {
  const memory = loadRaw();
  const initial = new Map<string, SqlParameterValue>();
  for (const field of fields) {
    const mapKey = parameterValueKey(field.kind, field.key);
    const stored = memory[parameterMemoryKey(field, sqlFingerprint)];
    initial.set(
      mapKey,
      stored
        ? { isNull: stored.isNull, value: stored.value }
        : { isNull: false, value: "" },
    );
  }
  return initial;
}

export function rememberParameterValues(
  fields: readonly SqlParameterField[],
  values: ReadonlyMap<string, SqlParameterValue>,
  sqlFingerprint: string | null,
): void {
  if (fields.length === 0) return;
  const memory = loadRaw();
  const now = Date.now();
  for (const field of fields) {
    const mapKey = parameterValueKey(field.kind, field.key);
    const value = values.get(mapKey);
    if (!value) continue;
    memory[parameterMemoryKey(field, sqlFingerprint)] = {
      isNull: value.isNull,
      value: value.value,
      updatedAt: now,
    };
  }
  saveRaw(prune(memory));
}
