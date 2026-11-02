import { isTauri } from "@tauri-apps/api/core";
import type { PlsqlEditorRef } from "./plsqlEditorConstants";

export const MAX_PLSQL_SNAPSHOTS = 20;
const SNAPSHOT_DIRECTORY = "plsql-snapshots/v1";

export type PlsqlSnapshotReason = "save" | "compile" | "manual";

export type PlsqlSnapshotEntry = {
  id: string;
  createdAt: number;
  reason: PlsqlSnapshotReason;
  content: string;
};

function storageKey(ref: PlsqlEditorRef): string {
  const parts = [
    encodeURIComponent(ref.profileId),
    encodeURIComponent(ref.schemaName),
    encodeURIComponent(ref.kind),
    encodeURIComponent(ref.objectName),
  ];
  if (ref.kind === "package" && ref.packageBody) {
    parts.push("body");
  }
  return "silk-db-studio.plsql.snapshots.v1:" + parts.join(":");
}

function normalizeEntry(value: unknown): PlsqlSnapshotEntry | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    typeof record.createdAt !== "number" ||
    typeof record.content !== "string" ||
    (record.reason !== "save" &&
      record.reason !== "compile" &&
      record.reason !== "manual")
  ) {
    return null;
  }
  return {
    id: record.id,
    createdAt: record.createdAt,
    reason: record.reason,
    content: record.content,
  };
}

function parseEntries<T>(raw: string | null, normalize: (value: unknown) => T | null): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalize)
      .filter((entry): entry is T => entry !== null)
      .slice(0, MAX_PLSQL_SNAPSHOTS);
  } catch {
    return [];
  }
}

function readLegacyEntries<T>(key: string, normalize: (value: unknown) => T | null): T[] {
  try {
    return parseEntries(localStorage.getItem(key), normalize);
  } catch {
    // Desktop file storage remains usable when WebView storage is unavailable or full.
    return [];
  }
}

function removeLegacyEntry(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // The AppData copy is authoritative after migration; cleanup is best effort.
  }
}

async function fileNameForKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${SNAPSHOT_DIRECTORY}/${hash}.json`;
}

async function readSnapshotEntries<T>(
  key: string,
  normalize: (value: unknown) => T | null,
): Promise<T[]> {
  if (!isTauri()) return parseEntries(localStorage.getItem(key), normalize);

  const { BaseDirectory, exists, readTextFile } = await import("@tauri-apps/plugin-fs");
  const fileName = await fileNameForKey(key);
  if (await exists(fileName, { baseDir: BaseDirectory.AppData })) {
    return parseEntries(await readTextFile(fileName, { baseDir: BaseDirectory.AppData }), normalize);
  }

  // Migrate the legacy browser entry lazily and retain it unless the disk write succeeds.
  const legacy = readLegacyEntries(key, normalize);
  if (legacy.length > 0) {
    await writeSnapshotEntries(key, legacy);
    removeLegacyEntry(key);
  }
  return legacy;
}

async function writeSnapshotEntries<T>(key: string, entries: T[]): Promise<void> {
  const raw = JSON.stringify(entries.slice(0, MAX_PLSQL_SNAPSHOTS));
  if (!isTauri()) {
    localStorage.setItem(key, raw);
    return;
  }

  const { BaseDirectory, mkdir, writeTextFile } = await import("@tauri-apps/plugin-fs");
  await mkdir(SNAPSHOT_DIRECTORY, { baseDir: BaseDirectory.AppData, recursive: true });
  await writeTextFile(await fileNameForKey(key), raw, { baseDir: BaseDirectory.AppData });
}

async function clearSnapshotEntries(key: string): Promise<void> {
  if (!isTauri()) {
    localStorage.removeItem(key);
    return;
  }
  await writeSnapshotEntries(key, []);
  removeLegacyEntry(key);
}

function createSnapshotId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `snap-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export async function loadPlsqlSnapshots(ref: PlsqlEditorRef): Promise<PlsqlSnapshotEntry[]> {
  return readSnapshotEntries(storageKey(ref), normalizeEntry);
}

export async function savePlsqlSnapshots(
  ref: PlsqlEditorRef,
  entries: PlsqlSnapshotEntry[],
): Promise<void> {
  await writeSnapshotEntries(storageKey(ref), entries);
}

export async function appendPlsqlSnapshot(
  ref: PlsqlEditorRef,
  content: string,
  reason: PlsqlSnapshotReason,
): Promise<PlsqlSnapshotEntry> {
  const entry: PlsqlSnapshotEntry = { id: createSnapshotId(), createdAt: Date.now(), reason, content };
  const next = [entry, ...await loadPlsqlSnapshots(ref)].slice(0, MAX_PLSQL_SNAPSHOTS);
  await savePlsqlSnapshots(ref, next);
  return entry;
}

export async function removePlsqlSnapshot(
  ref: PlsqlEditorRef,
  snapshotId: string,
): Promise<boolean> {
  const current = await loadPlsqlSnapshots(ref);
  const next = current.filter((entry) => entry.id !== snapshotId);
  if (next.length === current.length) return false;
  if (next.length === 0) await clearSnapshotEntries(storageKey(ref));
  else await savePlsqlSnapshots(ref, next);
  return true;
}

export async function clearPlsqlSnapshots(ref: PlsqlEditorRef): Promise<void> {
  await clearSnapshotEntries(storageKey(ref));
}

/**
 * Package snapshots record Spec + Body together (one entry = one snapshot event for the whole
 * package), rather than two independent per-section histories — matches how Save/Compare&Save
 * already always handles both halves as one operation. Separate storage key/shape from
 * `PlsqlSnapshotEntry` above (still used by procedures/functions/triggers/views, which only ever
 * have one buffer) — not a versioned migration of it, a distinct format entirely.
 */
export type PackagePlsqlSnapshotEntry = {
  id: string;
  createdAt: number;
  reason: PlsqlSnapshotReason;
  spec: string;
  body: string;
};

function packageStorageKey(ref: PlsqlEditorRef): string {
  return (
    "silk-db-studio.plsql.snapshots.package.v1:" +
    [
      encodeURIComponent(ref.profileId),
      encodeURIComponent(ref.schemaName),
      encodeURIComponent(ref.objectName),
    ].join(":")
  );
}

function normalizePackageEntry(value: unknown): PackagePlsqlSnapshotEntry | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    typeof record.createdAt !== "number" ||
    typeof record.spec !== "string" ||
    typeof record.body !== "string" ||
    (record.reason !== "save" &&
      record.reason !== "compile" &&
      record.reason !== "manual")
  ) {
    return null;
  }
  return {
    id: record.id,
    createdAt: record.createdAt,
    reason: record.reason,
    spec: record.spec,
    body: record.body,
  };
}

export async function loadPackagePlsqlSnapshots(ref: PlsqlEditorRef): Promise<PackagePlsqlSnapshotEntry[]> {
  return readSnapshotEntries(packageStorageKey(ref), normalizePackageEntry);
}

export function savePackagePlsqlSnapshots(
  ref: PlsqlEditorRef,
  entries: PackagePlsqlSnapshotEntry[],
): Promise<void> {
  return writeSnapshotEntries(packageStorageKey(ref), entries);
}

export function appendPackagePlsqlSnapshot(
  ref: PlsqlEditorRef,
  spec: string,
  body: string,
  reason: PlsqlSnapshotReason,
): Promise<PackagePlsqlSnapshotEntry> {
  const entry: PackagePlsqlSnapshotEntry = {
    id: createSnapshotId(),
    createdAt: Date.now(),
    reason,
    spec,
    body,
  };
  return loadPackagePlsqlSnapshots(ref).then(async (existing) => {
    const next = [entry, ...existing].slice(0, MAX_PLSQL_SNAPSHOTS);
    await savePackagePlsqlSnapshots(ref, next);
    return entry;
  });
}

export async function removePackagePlsqlSnapshot(ref: PlsqlEditorRef, snapshotId: string): Promise<boolean> {
  const current = await loadPackagePlsqlSnapshots(ref);
  const next = current.filter((entry) => entry.id !== snapshotId);
  if (next.length === current.length) {
    return false;
  }
  if (next.length === 0) {
    await clearSnapshotEntries(packageStorageKey(ref));
  } else {
    await savePackagePlsqlSnapshots(ref, next);
  }
  return true;
}

export async function clearPackagePlsqlSnapshots(ref: PlsqlEditorRef): Promise<void> {
  await clearSnapshotEntries(packageStorageKey(ref));
}
