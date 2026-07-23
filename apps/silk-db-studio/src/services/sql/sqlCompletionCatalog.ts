import type { MetadataColumn, MetadataObject } from "@silk-studio/db-protocol";
import { bridgeListColumns } from "../connection/connectionBridge";
import { ConnectionService } from "../connection/connectionService";
import { ConnectionTreeService } from "../connection/connectionTreeService";

const columnCache = new Map<string, MetadataColumn[]>();
/** Remember empty JDBC results so we do not retry the same miss every keystroke. */
const columnMissCache = new Set<string>();

function columnCacheKey(schema: string, table: string): string {
  return `${schema.toLowerCase()}\0${table.toLowerCase()}`;
}

export function clearSqlCompletionCaches(): void {
  columnCache.clear();
  columnMissCache.clear();
}

export function getConnectedProfileIdForCompletion(): string | null {
  return ConnectionService.getState().connectedProfileId;
}

/**
 * Preferred schema/catalog for unqualified object lookup.
 * Order: profile defaultSchema → catalog → login user (Oracle often uses user as schema).
 */
export function getDefaultSchemaForCompletion(): string | null {
  const candidates = schemaCandidatesForCompletion();
  return candidates[0] ?? null;
}

/** Distinct schema/catalog names to try when resolving `table.` → columns. */
export function schemaCandidatesForCompletion(): string[] {
  const profile = ConnectionService.getConnectedProfile();
  if (!profile) return [];

  const result: string[] = [];
  const add = (value: string | undefined | null) => {
    const trimmed = value?.trim();
    if (!trimmed) return;
    if (result.some((item) => item.toLowerCase() === trimmed.toLowerCase())) {
      return;
    }
    result.push(trimmed);
  };

  add(profile.defaultSchema);
  add(profile.catalog);
  // Oracle (and often SQL Server/PG) treat the login user as a default schema namespace.
  add(profile.user);

  return result;
}

export async function ensureSchemasLoaded(profileId: string): Promise<void> {
  const cache = ConnectionTreeService.getCache(profileId);
  if (cache.status === "loaded" || cache.status === "loading") {
    if (cache.status === "loading") {
      await waitUntil(
        () => ConnectionTreeService.getCache(profileId).status !== "loading",
      );
    }
    return;
  }
  try {
    await ConnectionTreeService.loadSchemas(profileId);
  } catch {
    // Autocomplete should degrade gracefully when metadata fails.
  }
}

export async function ensureSchemaObjectsLoaded(
  profileId: string,
  schemaName: string,
): Promise<void> {
  await ensureSchemasLoaded(profileId);
  const cache = ConnectionTreeService.getCache(profileId);
  const schema = cache.schemas.find(
    (item) => item.name.toLowerCase() === schemaName.toLowerCase(),
  );
  if (!schema) {
    // Schema may not be in the explorer list yet (e.g. user-as-schema). Still allow JDBC.
    return;
  }
  if (schema.status === "loaded") return;
  if (schema.status === "loading") {
    await waitUntil(() => {
      const next = ConnectionTreeService.getCache(profileId).schemas.find(
        (item) => item.name.toLowerCase() === schemaName.toLowerCase(),
      );
      return next?.status !== "loading";
    });
    return;
  }
  try {
    await ConnectionTreeService.loadSchemaObjects(profileId, schema.name);
  } catch {
    // ignore
  }
}

export function listSchemaNames(profileId: string): string[] {
  return ConnectionTreeService.getCache(profileId).schemas.map(
    (schema) => schema.name,
  );
}

export function listTablesAndViews(
  profileId: string,
  schemaName: string,
): MetadataObject[] {
  const schema = ConnectionTreeService.getCache(profileId).schemas.find(
    (item) => item.name.toLowerCase() === schemaName.toLowerCase(),
  );
  if (!schema || schema.status !== "loaded") return [];
  const result: MetadataObject[] = [];
  for (const group of schema.groups) {
    if (group.id !== "tables" && group.id !== "views") continue;
    result.push(...group.objects);
  }
  return result;
}

export function findSchemaName(
  profileId: string,
  name: string,
): string | undefined {
  return listSchemaNames(profileId).find(
    (schema) => schema.toLowerCase() === name.toLowerCase(),
  );
}

export function findTableInSchemas(
  profileId: string,
  tableName: string,
  preferredSchema?: string | null,
): { schema: string; table: string } | null {
  const caches = ConnectionTreeService.getCache(profileId).schemas.filter(
    (schema) => schema.status === "loaded",
  );
  const ordered = preferredSchema
    ? [
        ...caches.filter(
          (schema) =>
            schema.name.toLowerCase() === preferredSchema.toLowerCase(),
        ),
        ...caches.filter(
          (schema) =>
            schema.name.toLowerCase() !== preferredSchema.toLowerCase(),
        ),
      ]
    : caches;

  for (const schema of ordered) {
    for (const group of schema.groups) {
      if (group.id !== "tables" && group.id !== "views") continue;
      const match = group.objects.find(
        (object) => object.name.toLowerCase() === tableName.toLowerCase(),
      );
      if (match) {
        return { schema: schema.name, table: match.name };
      }
    }
  }
  return null;
}

/**
 * Resolve columns for `table.` — prefer explorer cache, then try JDBC against
 * defaultSchema / catalog / user until a non-empty list is returned.
 */
export async function resolveColumnsForTable(
  profileId: string,
  tableName: string,
): Promise<MetadataColumn[]> {
  const candidates = schemaCandidatesForCompletion();
  for (const schema of candidates) {
    await ensureSchemaObjectsLoaded(profileId, schema);
  }

  const preferred = candidates[0] ?? null;
  const found = findTableInSchemas(profileId, tableName, preferred);
  if (found) {
    return listColumnsCached(found.schema, found.table);
  }

  for (const schema of candidates) {
    const columns = await listColumnsCached(schema, tableName);
    if (columns.length > 0) {
      return columns;
    }
  }

  return [];
}

export async function listColumnsCached(
  schema: string,
  table: string,
): Promise<MetadataColumn[]> {
  const key = columnCacheKey(schema, table);
  const cached = columnCache.get(key);
  if (cached) return cached;
  if (columnMissCache.has(key)) return [];

  try {
    const result = await bridgeListColumns(schema, table);
    if (result.columns.length === 0) {
      columnMissCache.add(key);
      return [];
    }
    columnCache.set(key, result.columns);
    return result.columns;
  } catch (error) {
    console.warn(
      `[sql-completion] columns failed for ${schema}.${table}`,
      error,
    );
    columnMissCache.add(key);
    return [];
  }
}

function waitUntil(predicate: () => boolean, timeoutMs = 8000): Promise<void> {
  return new Promise((resolve) => {
    const started = Date.now();
    const unsubscribe = ConnectionTreeService.onDidChange(() => {
      if (predicate() || Date.now() - started > timeoutMs) {
        unsubscribe();
        resolve();
      }
    });
    if (predicate()) {
      unsubscribe();
      resolve();
    }
  });
}
