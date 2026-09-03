import type { PlsqlEditorRef } from "./plsqlEditorConstants";

export const MAX_PLSQL_SNAPSHOTS = 20;

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

export function loadPlsqlSnapshots(ref: PlsqlEditorRef): PlsqlSnapshotEntry[] {
  try {
    const raw = localStorage.getItem(storageKey(ref));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeEntry)
      .filter((entry): entry is PlsqlSnapshotEntry => entry !== null)
      .slice(0, MAX_PLSQL_SNAPSHOTS);
  } catch {
    return [];
  }
}

export function savePlsqlSnapshots(
  ref: PlsqlEditorRef,
  entries: PlsqlSnapshotEntry[],
): void {
  localStorage.setItem(
    storageKey(ref),
    JSON.stringify(entries.slice(0, MAX_PLSQL_SNAPSHOTS)),
  );
}

export function appendPlsqlSnapshot(
  ref: PlsqlEditorRef,
  content: string,
  reason: PlsqlSnapshotReason,
): PlsqlSnapshotEntry {
  const entry: PlsqlSnapshotEntry = {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `snap-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    createdAt: Date.now(),
    reason,
    content,
  };
  const next = [entry, ...loadPlsqlSnapshots(ref)].slice(0, MAX_PLSQL_SNAPSHOTS);
  savePlsqlSnapshots(ref, next);
  return entry;
}

export function removePlsqlSnapshot(
  ref: PlsqlEditorRef,
  snapshotId: string,
): boolean {
  const current = loadPlsqlSnapshots(ref);
  const next = current.filter((entry) => entry.id !== snapshotId);
  if (next.length === current.length) {
    return false;
  }
  if (next.length === 0) {
    try {
      localStorage.removeItem(storageKey(ref));
    } catch {
      savePlsqlSnapshots(ref, []);
    }
  } else {
    savePlsqlSnapshots(ref, next);
  }
  return true;
}

export function clearPlsqlSnapshots(ref: PlsqlEditorRef): void {
  try {
    localStorage.removeItem(storageKey(ref));
  } catch {
    savePlsqlSnapshots(ref, []);
  }
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

export function loadPackagePlsqlSnapshots(ref: PlsqlEditorRef): PackagePlsqlSnapshotEntry[] {
  try {
    const raw = localStorage.getItem(packageStorageKey(ref));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizePackageEntry)
      .filter((entry): entry is PackagePlsqlSnapshotEntry => entry !== null)
      .slice(0, MAX_PLSQL_SNAPSHOTS);
  } catch {
    return [];
  }
}

export function savePackagePlsqlSnapshots(
  ref: PlsqlEditorRef,
  entries: PackagePlsqlSnapshotEntry[],
): void {
  localStorage.setItem(
    packageStorageKey(ref),
    JSON.stringify(entries.slice(0, MAX_PLSQL_SNAPSHOTS)),
  );
}

export function appendPackagePlsqlSnapshot(
  ref: PlsqlEditorRef,
  spec: string,
  body: string,
  reason: PlsqlSnapshotReason,
): PackagePlsqlSnapshotEntry {
  const entry: PackagePlsqlSnapshotEntry = {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `snap-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    createdAt: Date.now(),
    reason,
    spec,
    body,
  };
  const next = [entry, ...loadPackagePlsqlSnapshots(ref)].slice(0, MAX_PLSQL_SNAPSHOTS);
  savePackagePlsqlSnapshots(ref, next);
  return entry;
}

export function removePackagePlsqlSnapshot(ref: PlsqlEditorRef, snapshotId: string): boolean {
  const current = loadPackagePlsqlSnapshots(ref);
  const next = current.filter((entry) => entry.id !== snapshotId);
  if (next.length === current.length) {
    return false;
  }
  if (next.length === 0) {
    try {
      localStorage.removeItem(packageStorageKey(ref));
    } catch {
      savePackagePlsqlSnapshots(ref, []);
    }
  } else {
    savePackagePlsqlSnapshots(ref, next);
  }
  return true;
}

export function clearPackagePlsqlSnapshots(ref: PlsqlEditorRef): void {
  try {
    localStorage.removeItem(packageStorageKey(ref));
  } catch {
    savePackagePlsqlSnapshots(ref, []);
  }
}
