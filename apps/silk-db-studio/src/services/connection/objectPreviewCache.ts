import type { ObjectEditorRef } from "./objectEditorConstants";

/**
 * In-memory cache for the Object Editor's Properties sub-section previews
 * (Columns/Indexes/ForeignKeys/References/Constraints/Triggers/Dependencies).
 *
 * These preview components live inside the Object Editor tab content area, so switching to
 * another editor tab and back fully unmounts/remounts them — without this cache, every revisit
 * re-fetches metadata from the database from scratch. This mirrors `ConnectionTreeService`'s own
 * philosophy for the Explorer's schema tree: cache indefinitely, invalidate only on an explicit
 * refresh/disconnect, never on a timer.
 */
export type ObjectPreviewCacheKind =
  | "columns"
  | "indexes"
  | "foreignKeys"
  | "references"
  | "constraints"
  | "triggers"
  | "dependencies";

const cache = new Map<string, unknown>();

function buildKey(
  kind: ObjectPreviewCacheKind,
  profileId: string,
  schemaName: string,
  objectName: string,
  catalogName?: string | null,
): string {
  return [
    kind,
    encodeURIComponent(profileId),
    encodeURIComponent(catalogName?.trim() ?? ""),
    encodeURIComponent(schemaName),
    encodeURIComponent(objectName),
  ].join("::");
}

export function getCachedObjectPreview<T>(
  kind: ObjectPreviewCacheKind,
  ref: ObjectEditorRef,
): T | undefined {
  const key = buildKey(
    kind,
    ref.profileId,
    ref.schemaName,
    ref.objectName,
    ref.catalogName,
  );
  return cache.get(key) as T | undefined;
}

export function setCachedObjectPreview<T>(
  kind: ObjectPreviewCacheKind,
  ref: ObjectEditorRef,
  value: T,
): void {
  const key = buildKey(
    kind,
    ref.profileId,
    ref.schemaName,
    ref.objectName,
    ref.catalogName,
  );
  cache.set(key, value);
}

/**
 * Clears cached preview entries.
 * - `profileId` only: clears every entry for that connection (disconnect).
 * - `profileId` + `schemaName`: clears every entry under that schema (schema-level refresh).
 * - `profileId` + `schemaName` + `objectName`: clears just that one object's entries.
 */
export function invalidateObjectPreviewCache(
  profileId: string,
  schemaName?: string,
  objectName?: string,
): void {
  const profilePart = `::${encodeURIComponent(profileId)}::`;
  const schemaPart =
    schemaName !== undefined ? `::${encodeURIComponent(schemaName)}::` : null;
  const objectSuffix =
    objectName !== undefined ? `::${encodeURIComponent(objectName)}` : null;

  for (const key of cache.keys()) {
    if (!key.includes(profilePart)) continue;
    if (schemaPart && !key.includes(schemaPart)) continue;
    if (objectSuffix && !key.endsWith(objectSuffix)) continue;
    cache.delete(key);
  }
}

/** Clears every cached entry, for every profile. Useful for test isolation. */
export function clearAllObjectPreviewCache(): void {
  cache.clear();
}
