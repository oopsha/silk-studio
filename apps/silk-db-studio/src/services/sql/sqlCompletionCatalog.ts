import type { MetadataColumn, MetadataObject } from "@silk-studio/db-protocol";
import { bridgeListColumns } from "../connection/connectionBridge";
import { ConnectionService } from "../connection/connectionService";
import { ConnectionTreeService } from "../connection/connectionTreeService";
import { effectiveDefaultSchema } from "../connection/connectionTypes";
import { getExplorerSchemas } from "../connection/useConnectionTree";
import {
  COLUMN_CACHE_TTL_MS,
  SCHEMA_LOAD_BUDGET_MS,
} from "./sqlCompletionRanking";

type ColumnCacheEntry = {
  columns: MetadataColumn[];
  expiresAt: number;
};

const columnCache = new Map<string, ColumnCacheEntry>();
/** Remember empty JDBC results so we do not retry the same miss every keystroke. */
const columnMissCache = new Map<string, number>();
/** Deduplicate in-flight JDBC column fetches. */
const columnInflight = new Map<string, Promise<MetadataColumn[]>>();

function columnCacheKey(schema: string, table: string): string {
  const profileId =
    ConnectionService.getState().connectedProfileId ?? "_none_";
  return `${profileId}\0${schema.toLowerCase()}\0${table.toLowerCase()}`;
}

export function clearSqlCompletionCaches(): void {
  columnCache.clear();
  columnMissCache.clear();
  columnInflight.clear();
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

  add(effectiveDefaultSchema(profile));
  add(profile.catalog);
  // Keep login user as a fallback candidate for dialects where user ≈ schema.
  add(profile.user);

  return result;
}

export async function ensureSchemasLoaded(profileId: string): Promise<void> {
  const cache = ConnectionTreeService.getCache(profileId);
  if (cache.status === "loaded" || cache.status === "loading") {
    if (cache.status === "loading") {
      await waitUntil(
        () => ConnectionTreeService.getCache(profileId).status !== "loading",
        SCHEMA_LOAD_BUDGET_MS * 4,
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

/**
 * Ensure schema objects are loading / loaded without blocking Suggest for long.
 * Returns true when objects are available now.
 */
export async function ensureSchemaObjectsLoaded(
  profileId: string,
  schemaName: string,
  options?: { budgetMs?: number },
): Promise<boolean> {
  const budgetMs = options?.budgetMs ?? SCHEMA_LOAD_BUDGET_MS;
  await ensureSchemasLoaded(profileId);
  const cache = ConnectionTreeService.getCache(profileId);
  const schemas = getExplorerSchemas(cache);
  const schema = schemas.find(
    (item) => item.name.toLowerCase() === schemaName.toLowerCase(),
  );
  if (!schema) {
    // Schema may not be in the explorer list yet (e.g. user-as-schema). Still allow JDBC.
    return true;
  }
  if (schema.status === "loaded") return true;

  if (schema.status !== "loading") {
    void ConnectionTreeService.loadSchemaObjects(
      profileId,
      schema.name,
      false,
      cache.currentCatalog ?? undefined,
    ).catch(() => {
      // ignore — next keystroke may retry via status
    });
  }

  const ready = await waitUntil(() => {
    const next = getExplorerSchemas(
      ConnectionTreeService.getCache(profileId),
    ).find((item) => item.name.toLowerCase() === schemaName.toLowerCase());
    return next?.status === "loaded" || next?.status === "error";
  }, budgetMs);

  const latest = getExplorerSchemas(
    ConnectionTreeService.getCache(profileId),
  ).find((item) => item.name.toLowerCase() === schemaName.toLowerCase());
  return latest?.status === "loaded" || ready;
}

export function listSchemaNames(profileId: string): string[] {
  return getExplorerSchemas(ConnectionTreeService.getCache(profileId)).map(
    (schema) => schema.name,
  );
}

export function listTablesAndViews(
  profileId: string,
  schemaName: string,
): MetadataObject[] {
  const schema = getExplorerSchemas(
    ConnectionTreeService.getCache(profileId),
  ).find((item) => item.name.toLowerCase() === schemaName.toLowerCase());
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
  const caches = getExplorerSchemas(
    ConnectionTreeService.getCache(profileId),
  ).filter((schema) => schema.status === "loaded");
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
  const preferred = candidates[0] ?? null;

  // Prefer default schema first (avoid N sequential loads on every keystroke).
  if (preferred) {
    await ensureSchemaObjectsLoaded(profileId, preferred);
    const found = findTableInSchemas(profileId, tableName, preferred);
    if (found) {
      return listColumnsCached(found.schema, found.table);
    }
    const columns = await listColumnsCached(preferred, tableName);
    if (columns.length > 0) return columns;
  }

  for (const schema of candidates.slice(1)) {
    await ensureSchemaObjectsLoaded(profileId, schema);
    const found = findTableInSchemas(profileId, tableName, schema);
    if (found) {
      return listColumnsCached(found.schema, found.table);
    }
    const columns = await listColumnsCached(schema, tableName);
    if (columns.length > 0) return columns;
  }

  return [];
}

export async function listColumnsCached(
  schema: string,
  table: string,
): Promise<MetadataColumn[]> {
  const key = columnCacheKey(schema, table);
  const now = Date.now();
  const cached = columnCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.columns;
  }
  const missUntil = columnMissCache.get(key);
  if (missUntil !== undefined && missUntil > now) {
    return [];
  }

  const inflight = columnInflight.get(key);
  if (inflight) return inflight;

  const request = (async (): Promise<MetadataColumn[]> => {
    try {
      const result = await bridgeListColumns(schema, table);
      if (result.columns.length === 0) {
        columnMissCache.set(key, now + COLUMN_CACHE_TTL_MS);
        return [];
      }
      columnCache.set(key, {
        columns: result.columns,
        expiresAt: now + COLUMN_CACHE_TTL_MS,
      });
      columnMissCache.delete(key);
      return result.columns;
    } catch (error) {
      console.warn(
        `[sql-completion] columns failed for ${schema}.${table}`,
        error,
      );
      columnMissCache.set(key, now + COLUMN_CACHE_TTL_MS);
      return [];
    } finally {
      columnInflight.delete(key);
    }
  })();

  columnInflight.set(key, request);
  return request;
}

function waitUntil(
  predicate: () => boolean,
  timeoutMs = 8000,
): Promise<boolean> {
  return new Promise((resolve) => {
    if (predicate()) {
      resolve(true);
      return;
    }
    const started = Date.now();
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(value);
    };
    const unsubscribe = ConnectionTreeService.onDidChange(() => {
      if (predicate()) {
        finish(true);
      } else if (Date.now() - started > timeoutMs) {
        finish(false);
      }
    });
    const timer = setTimeout(() => {
      finish(predicate());
    }, timeoutMs);
  });
}
