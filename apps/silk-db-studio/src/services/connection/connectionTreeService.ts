import type {
  ConnectionMetadataResult,
  MetadataGroup,
  MetadataSchema,
} from "@silk-studio/db-protocol";
import {
  bridgeConnectionPrefetchCatalog,
  bridgeListMetadata,
} from "./connectionBridge";
import { formatErrorMessage } from "../formatErrorMessage";
import {
  filterSystemNamespaces,
  type ExplorerFilterContext,
} from "./systemNamespaces";
import { invalidateObjectPreviewCache } from "./objectPreviewCache";

export type SchemaTreeNode = {
  name: string;
  status: "idle" | "loading" | "loaded" | "error";
  errorMessage: string | null;
  /** Only groups the connected database supports are present — see `MetadataGroupId`. */
  groups: MetadataGroup[];
  /**
   * `"lite"` when `groups` only holds tables/views/procedures/functions (background prefetch —
   * see `prefetchCatalog`); `"full"` (or absent, for backward compat) when it holds every
   * category the dialect supports (a deliberate Explorer "expand this schema" click). A `"lite"`
   * schema is treated as NOT satisfying a subsequent full-detail request — see `loadSchemaObjects`
   * — so background prefetch never permanently blocks Explorer from showing indexes/triggers/etc.
   */
  detail?: "lite" | "full";
};

export type CatalogTreeNode = {
  name: string;
  status: "idle" | "loading" | "loaded" | "error";
  errorMessage: string | null;
  schemas: SchemaTreeNode[];
};

export type ProfileTreeCache = {
  status: "idle" | "loading" | "loaded" | "error";
  errorMessage: string | null;
  /** When non-empty, Explorer shows Databases → schemas (SQL Server). */
  catalogs: CatalogTreeNode[];
  currentCatalog: string | null;
  schemas: SchemaTreeNode[];
};

type TreeListener = () => void;

/**
 * Coalesces bursts of `fireDidChange()` (e.g. the search prefetch service loading hundreds of
 * schemas back-to-back) into at most one listener notification per window, instead of a full
 * React re-render per completion. The underlying cache state is always updated synchronously
 * before `fireDidChange()` is called, so delaying/merging the *notification* only delays how
 * soon the UI reflects it — it never changes what state a subsequent `getCache()` read sees.
 */
const NOTIFY_DEBOUNCE_MS = 80;

class ConnectionTreeServiceImpl {
  private readonly caches = new Map<string, ProfileTreeCache>();
  private readonly listeners = new Set<TreeListener>();
  private readonly explorerFilters = new Map<string, ExplorerFilterContext>();
  private readonly connectedProfileIds = new Set<string>();
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;

  getCache(profileId: string): ProfileTreeCache {
    return (
      this.caches.get(profileId) ?? {
        status: "idle",
        errorMessage: null,
        catalogs: [],
        currentCatalog: null,
        schemas: [],
      }
    );
  }

  /** Update explorer highlight only (session catalog already applied). */
  setCurrentCatalog(profileId: string, catalogName: string): void {
    const cache = this.getCache(profileId);
    const name = catalogName.trim();
    if (!name) return;
    if (
      cache.currentCatalog &&
      cache.currentCatalog.toLowerCase() === name.toLowerCase()
    ) {
      return;
    }
    this.caches.set(profileId, {
      ...cache,
      currentCatalog: name,
    });
    this.fireDidChange();
  }

  setExplorerFilter(
    profileId: string,
    filter: ExplorerFilterContext | null,
  ): void {
    if (!filter) {
      this.explorerFilters.delete(profileId);
    } else {
      this.explorerFilters.set(profileId, filter);
    }
  }

  isProfileConnected(profileId: string): boolean {
    return this.connectedProfileIds.has(profileId);
  }

  /** Keep in sync from ConnectionService after connect (avoids import cycle). */
  addConnectedProfile(profileId: string): void {
    if (this.connectedProfileIds.has(profileId)) return;
    this.connectedProfileIds.add(profileId);
    this.fireDidChange();
  }

  /** Keep in sync from ConnectionService after disconnect. */
  removeConnectedProfile(profileId: string): void {
    if (!this.connectedProfileIds.delete(profileId)) return;
    this.fireDidChange();
  }

  /**
   * @deprecated Use {@link addConnectedProfile} / {@link removeConnectedProfile}.
   * Passing null clears all connected markers (does not wipe sibling caches unless clearing).
   */
  setConnectedProfileId(profileId: string | null): void {
    if (profileId === null) {
      if (this.connectedProfileIds.size === 0) return;
      this.connectedProfileIds.clear();
      this.fireDidChange();
      return;
    }
    this.addConnectedProfile(profileId);
  }

  invalidate(profileId?: string): void {
    if (profileId) {
      this.caches.delete(profileId);
      invalidateObjectPreviewCache(profileId);
    } else {
      for (const cachedProfileId of this.caches.keys()) {
        invalidateObjectPreviewCache(cachedProfileId);
      }
      this.caches.clear();
      this.explorerFilters.clear();
    }
    this.fireDidChange();
  }

  /**
   * Clear cached objects for one schema so the next expand / refresh reloads them.
   * Does not remove the schema from the list.
   */
  invalidateSchema(
    profileId: string,
    schemaName: string,
    catalogName?: string,
  ): void {
    invalidateObjectPreviewCache(profileId, schemaName);

    const cache = this.caches.get(profileId);
    if (!cache) return;

    if (cache.catalogs.length > 0) {
      if (!catalogName) return;
      let changed = false;
      const catalogs = cache.catalogs.map((catalog) => {
        if (catalog.name.toLowerCase() !== catalogName.toLowerCase()) {
          return catalog;
        }
        const schemas = catalog.schemas.map((schema) => {
          if (schema.name.toLowerCase() !== schemaName.toLowerCase()) {
            return schema;
          }
          changed = true;
          return {
            name: schema.name,
            status: "idle" as const,
            errorMessage: null,
            groups: [],
          };
        });
        return { ...catalog, schemas };
      });
      if (!changed) return;
      this.caches.set(profileId, { ...cache, catalogs });
      this.fireDidChange();
      return;
    }

    let changed = false;
    const schemas = cache.schemas.map((schema) => {
      if (schema.name.toLowerCase() !== schemaName.toLowerCase()) {
        return schema;
      }
      changed = true;
      return {
        name: schema.name,
        status: "idle" as const,
        errorMessage: null,
        groups: [],
      };
    });
    if (!changed) return;

    this.caches.set(profileId, { ...cache, schemas });
    this.fireDidChange();
  }

  /** Force-reload objects under a schema (all groups). */
  async refreshSchemaObjects(
    profileId: string,
    schemaName: string,
    catalogName?: string,
  ): Promise<void> {
    await this.loadSchemaObjects(profileId, schemaName, true, catalogName);
  }

  /**
   * Drop one schema's object cache, then reload it.
   * Prefer this after DDL mutations (6-E) so the tree matches the database.
   */
  async invalidateAndRefreshSchema(
    profileId: string,
    schemaName: string,
    catalogName?: string,
  ): Promise<void> {
    this.invalidateSchema(profileId, schemaName, catalogName);
    await this.loadSchemaObjects(profileId, schemaName, true, catalogName);
  }

  /** Load top-level schemas, or catalogs when the dialect uses a Databases level. */
  async loadSchemas(profileId: string, force = false): Promise<void> {
    if (!this.connectedProfileIds.has(profileId)) {
      throw new Error("Connect this profile before loading database objects.");
    }

    const current = this.getCache(profileId);
    if (!force && (current.status === "loaded" || current.status === "loading")) {
      return;
    }

    this.caches.set(profileId, {
      status: "loading",
      errorMessage: null,
      catalogs: current.catalogs,
      currentCatalog: current.currentCatalog,
      schemas: current.schemas,
    });
    this.fireDidChange();

    try {
      const result = await bridgeListMetadata(profileId);
      const filter = this.explorerFilters.get(profileId);
      const catalogs = filterSystemNamespaces(
        (result.catalogs ?? []).map((item) => item.name),
        filter,
      ).map((name) => ({ name }));
      if ((result.catalogs ?? []).length > 0) {
        this.caches.set(profileId, {
          status: "loaded",
          errorMessage: null,
          catalogs: toCatalogNodes(
            { ...result, catalogs },
            current.catalogs,
          ),
          currentCatalog: result.currentCatalog?.trim() || null,
          schemas: [],
        });
      } else {
        const schemaNames = filterSystemNamespaces(
          result.schemas.map((item) => item.name),
          filter,
        );
        const allowed = new Set(schemaNames.map((name) => name.toLowerCase()));
        const schemas = result.schemas.filter((item) =>
          allowed.has(item.name.toLowerCase()),
        );
        this.caches.set(profileId, {
          status: "loaded",
          errorMessage: null,
          catalogs: [],
          currentCatalog: result.currentCatalog?.trim() || null,
          schemas: toSchemaNodes({ ...result, schemas }, current.schemas),
        });
      }
      this.fireDidChange();
    } catch (error) {
      this.caches.set(profileId, {
        status: "error",
        errorMessage: formatErrorMessage(error, "Failed to load schemas."),
        catalogs: [],
        currentCatalog: null,
        schemas: [],
      });
      this.fireDidChange();
      throw error;
    }
  }

  async loadCatalogSchemas(
    profileId: string,
    catalogName: string,
    force = false,
  ): Promise<void> {
    if (!this.connectedProfileIds.has(profileId)) {
      throw new Error("Connect this profile before loading database objects.");
    }

    const cache = this.getCache(profileId);
    const catalog = cache.catalogs.find(
      (item) => item.name.toLowerCase() === catalogName.toLowerCase(),
    );
    if (!catalog) {
      throw new Error(`Database not found: ${catalogName}`);
    }
    if (!force && (catalog.status === "loaded" || catalog.status === "loading")) {
      // Session switch is handled by ActiveDatabaseService.useDatabase / expand.
      return;
    }

    const nextCatalogs = cache.catalogs.map((item) =>
      item.name.toLowerCase() === catalogName.toLowerCase()
        ? { ...item, status: "loading" as const, errorMessage: null }
        : item,
    );
    this.caches.set(profileId, {
      ...cache,
      status: "loaded",
      catalogs: nextCatalogs,
    });
    this.fireDidChange();

    try {
      const result = await bridgeListMetadata(profileId, undefined, catalogName);
      const filter = this.explorerFilters.get(profileId);
      const schemaNames = filterSystemNamespaces(
        result.schemas.map((item) => item.name),
        filter,
      );
      const allowed = new Set(schemaNames.map((name) => name.toLowerCase()));
      const schemasResult = {
        ...result,
        schemas: result.schemas.filter((item) =>
          allowed.has(item.name.toLowerCase()),
        ),
      };
      const schemas = toSchemaNodes(schemasResult, catalog.schemas);
      this.caches.set(profileId, {
        status: "loaded",
        errorMessage: null,
        // Reading another catalog's schemas is a pure metadata query now (no
        // connection.setCatalog on the Java side) — currentCatalog still reflects
        // whatever the shared session is actually on, never the catalog we just read.
        currentCatalog: result.currentCatalog?.trim() || cache.currentCatalog,
        schemas: [],
        catalogs: (this.caches.get(profileId)?.catalogs ?? nextCatalogs).map(
          (item) =>
            item.name.toLowerCase() === catalogName.toLowerCase()
              ? {
                  name: item.name,
                  status: "loaded",
                  errorMessage: null,
                  schemas,
                }
              : item,
        ),
      });
      this.fireDidChange();
    } catch (error) {
      const message = formatErrorMessage(
        error,
        "Failed to load database schemas.",
      );
      this.caches.set(profileId, {
        status: "loaded",
        errorMessage: null,
        currentCatalog: cache.currentCatalog,
        schemas: [],
        catalogs: (this.caches.get(profileId)?.catalogs ?? nextCatalogs).map(
          (item) =>
            item.name.toLowerCase() === catalogName.toLowerCase()
              ? {
                  ...item,
                  status: "error",
                  errorMessage: message,
                  schemas: [],
                }
              : item,
        ),
      });
      this.fireDidChange();
      throw error;
    }
  }

  /**
   * @param includeSecondaryKinds When `false`, skips indexes/sequences/synonyms/triggers/
   * types (5 extra round trips) and only fetches tables/views/procedures/functions. Bulk
   * callers (prefetch, Ctrl+Shift+O "load database/schema") pass `false` for speed; a single
   * deliberate Explorer "expand this schema" click passes `true` (default) for the full picture.
   */
  async loadSchemaObjects(
    profileId: string,
    schemaName: string,
    force = false,
    catalogName?: string,
    includeSecondaryKinds = true,
  ): Promise<void> {
    if (!this.connectedProfileIds.has(profileId)) {
      throw new Error("Connect this profile before loading database objects.");
    }

    const cache = this.getCache(profileId);

    if (cache.catalogs.length > 0) {
      if (!catalogName) {
        throw new Error("Database name is required for this connection.");
      }
      await this.loadSchemaObjectsInCatalog(
        profileId,
        catalogName,
        schemaName,
        force,
        includeSecondaryKinds,
      );
      return;
    }

    const schema = cache.schemas.find(
      (item) => item.name.toLowerCase() === schemaName.toLowerCase(),
    );
    if (!schema) {
      throw new Error(`Schema not found: ${schemaName}`);
    }
    // A "lite" schema (background prefetch) doesn't satisfy a full-detail request — see
    // SchemaTreeNode.detail's doc comment — so it gets reloaded even without `force`.
    const alreadySatisfied =
      schema.status === "loaded" &&
      !(includeSecondaryKinds && schema.detail === "lite");
    if (!force && (schema.status === "loading" || alreadySatisfied)) {
      return;
    }

    const nextSchemas = cache.schemas.map((item) =>
      item.name.toLowerCase() === schemaName.toLowerCase()
        ? { ...item, status: "loading" as const, errorMessage: null }
        : item,
    );
    this.caches.set(profileId, {
      ...cache,
      status: "loaded",
      schemas: nextSchemas,
    });
    this.fireDidChange();

    try {
      const result = await bridgeListMetadata(
        profileId,
        schemaName,
        undefined,
        includeSecondaryKinds,
      );
      const loaded = result.schemas.find(
        (item) => item.name.toLowerCase() === schemaName.toLowerCase(),
      );
      const groups = loaded?.groups ?? [];
      this.caches.set(profileId, {
        status: "loaded",
        errorMessage: null,
        catalogs: [],
        currentCatalog: result.currentCatalog?.trim() || cache.currentCatalog,
        schemas: (this.caches.get(profileId)?.schemas ?? nextSchemas).map(
          (item) =>
            item.name.toLowerCase() === schemaName.toLowerCase()
              ? {
                  name: item.name,
                  status: "loaded",
                  errorMessage: null,
                  groups,
                  detail: includeSecondaryKinds ? "full" : "lite",
                }
              : item,
        ),
      });
      this.fireDidChange();
    } catch (error) {
      const message = formatErrorMessage(error, "Failed to load schema objects.");
      this.caches.set(profileId, {
        status: "loaded",
        errorMessage: null,
        catalogs: [],
        currentCatalog: cache.currentCatalog,
        schemas: (this.caches.get(profileId)?.schemas ?? nextSchemas).map(
          (item) =>
            item.name.toLowerCase() === schemaName.toLowerCase()
              ? {
                  ...item,
                  status: "error",
                  errorMessage: message,
                  groups: [],
                }
              : item,
        ),
      });
      this.fireDidChange();
      throw error;
    }
  }

  private async loadSchemaObjectsInCatalog(
    profileId: string,
    catalogName: string,
    schemaName: string,
    force: boolean,
    includeSecondaryKinds = true,
  ): Promise<void> {
    const cache = this.getCache(profileId);
    const catalog = cache.catalogs.find(
      (item) => item.name.toLowerCase() === catalogName.toLowerCase(),
    );
    if (!catalog) {
      throw new Error(`Database not found: ${catalogName}`);
    }
    const schema = catalog.schemas.find(
      (item) => item.name.toLowerCase() === schemaName.toLowerCase(),
    );
    if (!schema) {
      throw new Error(`Schema not found: ${schemaName}`);
    }
    // See loadSchemaObjects's identical guard — a "lite" schema never satisfies a full-detail
    // request on its own.
    const alreadySatisfied =
      schema.status === "loaded" &&
      !(includeSecondaryKinds && schema.detail === "lite");
    if (!force && (schema.status === "loading" || alreadySatisfied)) {
      return;
    }

    const nextCatalogs = cache.catalogs.map((item) => {
      if (item.name.toLowerCase() !== catalogName.toLowerCase()) return item;
      return {
        ...item,
        schemas: item.schemas.map((entry) =>
          entry.name.toLowerCase() === schemaName.toLowerCase()
            ? { ...entry, status: "loading" as const, errorMessage: null }
            : entry,
        ),
      };
    });
    this.caches.set(profileId, {
      ...cache,
      status: "loaded",
      catalogs: nextCatalogs,
    });
    this.fireDidChange();

    try {
      const result = await bridgeListMetadata(
        profileId,
        schemaName,
        catalogName,
        includeSecondaryKinds,
      );
      const loaded = result.schemas.find(
        (item) => item.name.toLowerCase() === schemaName.toLowerCase(),
      );
      const groups = loaded?.groups ?? [];
      this.caches.set(profileId, {
        status: "loaded",
        errorMessage: null,
        // Same as loadCatalogSchemas: reading another catalog's objects no longer touches
        // the shared session's catalog, so don't fall back to the catalog we just read.
        currentCatalog: result.currentCatalog?.trim() || cache.currentCatalog,
        schemas: [],
        catalogs: (this.caches.get(profileId)?.catalogs ?? nextCatalogs).map(
          (item) => {
            if (item.name.toLowerCase() !== catalogName.toLowerCase()) {
              return item;
            }
            return {
              ...item,
              schemas: item.schemas.map((entry) =>
                entry.name.toLowerCase() === schemaName.toLowerCase()
                  ? {
                      name: entry.name,
                      status: "loaded" as const,
                      errorMessage: null,
                      groups,
                      detail: includeSecondaryKinds ? "full" : "lite",
                    }
                  : entry,
              ),
            };
          },
        ),
      });
      this.fireDidChange();
    } catch (error) {
      const message = formatErrorMessage(error, "Failed to load schema objects.");
      this.caches.set(profileId, {
        status: "loaded",
        errorMessage: null,
        currentCatalog: cache.currentCatalog,
        schemas: [],
        catalogs: (this.caches.get(profileId)?.catalogs ?? nextCatalogs).map(
          (item) => {
            if (item.name.toLowerCase() !== catalogName.toLowerCase()) {
              return item;
            }
            return {
              ...item,
              schemas: item.schemas.map((entry) =>
                entry.name.toLowerCase() === schemaName.toLowerCase()
                  ? {
                      ...entry,
                      status: "error" as const,
                      errorMessage: message,
                      groups: [],
                    }
                  : entry,
              ),
            };
          },
        ),
      });
      this.fireDidChange();
      throw error;
    }
  }

  /**
   * Background-prefetch support (Ctrl+Shift+O search index): fetches every schema's lightweight
   * object list for one catalog — or, when `catalogName` is omitted, the whole profile for
   * dialects with no catalog concept — in a single round trip, instead of one `loadSchemaObjects`
   * call per schema. See `ExplorerSearchPrefetchService` for the caller: collapsing per-schema
   * IPC calls down to one per catalog is what fixes the input lag those calls were causing when
   * fired in a burst (confirmed by elimination testing to be about call *count*, not rate).
   *
   * Schemas already `status: "loaded"` (whether from a richer manual Explorer expand or an
   * earlier prefetch pass) are left untouched — this only fills in schemas not covered yet.
   */
  async prefetchCatalog(
    profileId: string,
    catalogName?: string,
    maxObjects?: number,
  ): Promise<void> {
    if (!this.connectedProfileIds.has(profileId)) {
      throw new Error("Connect this profile before loading database objects.");
    }

    const result = await bridgeConnectionPrefetchCatalog(
      profileId,
      catalogName,
      maxObjects,
    );
    const filter = this.explorerFilters.get(profileId);
    const schemaNames = filterSystemNamespaces(
      result.schemas.map((item) => item.name),
      filter,
    );
    const allowed = new Set(schemaNames.map((name) => name.toLowerCase()));
    const filteredSchemas = result.schemas.filter((item) =>
      allowed.has(item.name.toLowerCase()),
    );

    const cache = this.getCache(profileId);
    if (catalogName) {
      const catalog = cache.catalogs.find(
        (item) => item.name.toLowerCase() === catalogName.toLowerCase(),
      );
      if (!catalog) return;
      const schemas = toLiteSchemaNodes(filteredSchemas, catalog.schemas);
      this.caches.set(profileId, {
        ...cache,
        catalogs: cache.catalogs.map((item) =>
          item.name.toLowerCase() === catalogName.toLowerCase()
            ? {
                ...item,
                // Mark the catalog itself "loaded" too — otherwise a manual Explorer expand
                // of this same catalog would see status "idle" and redundantly re-fetch
                // schema names via loadCatalogSchemas (harmless, since toSchemaNodes keeps
                // these lite-but-loaded entries, but a wasted round trip).
                status: "loaded" as const,
                errorMessage: null,
                schemas,
              }
            : item,
        ),
      });
    } else {
      const schemas = toLiteSchemaNodes(filteredSchemas, cache.schemas);
      this.caches.set(profileId, { ...cache, schemas });
    }
    this.fireDidChange();
  }

  onDidChange(listener: TreeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    if (this.notifyTimer !== null) {
      clearTimeout(this.notifyTimer);
      this.notifyTimer = null;
    }
    this.listeners.clear();
    this.caches.clear();
    this.explorerFilters.clear();
    this.connectedProfileIds.clear();
  }

  private fireDidChange(): void {
    if (this.notifyTimer !== null) return;
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      for (const listener of this.listeners) {
        listener();
      }
    }, NOTIFY_DEBOUNCE_MS);
  }
}

function toCatalogNodes(
  result: ConnectionMetadataResult,
  previous: CatalogTreeNode[],
): CatalogTreeNode[] {
  const previousByName = new Map(
    previous.map((catalog) => [catalog.name.toLowerCase(), catalog]),
  );
  return (result.catalogs ?? []).map((catalog) => {
    const existing = previousByName.get(catalog.name.toLowerCase());
    if (existing && existing.status === "loaded" && existing.schemas.length > 0) {
      return existing;
    }
    return {
      name: catalog.name,
      status: "idle" as const,
      errorMessage: null,
      schemas: existing?.schemas ?? [],
    };
  });
}

function toSchemaNodes(
  result: ConnectionMetadataResult,
  previous: SchemaTreeNode[],
): SchemaTreeNode[] {
  const previousByName = new Map(
    previous.map((schema) => [schema.name.toLowerCase(), schema]),
  );
  return result.schemas.map((schema: MetadataSchema) => {
    const existing = previousByName.get(schema.name.toLowerCase());
    if (existing?.status === "loaded") {
      return existing;
    }
    return {
      name: schema.name,
      status: "idle" as const,
      errorMessage: null,
      groups: [],
    };
  });
}

/**
 * Like {@link toSchemaNodes}, but the source (`connection.prefetchCatalog`'s result) already
 * carries populated `groups` — new nodes go straight to `status: "loaded", detail: "lite"`
 * instead of `"idle"`. Existing `"loaded"` nodes (any detail) are kept as-is, same "don't
 * downgrade/refetch what's already there" rule {@link toSchemaNodes} uses.
 */
function toLiteSchemaNodes(
  schemas: MetadataSchema[],
  previous: SchemaTreeNode[],
): SchemaTreeNode[] {
  const previousByName = new Map(
    previous.map((schema) => [schema.name.toLowerCase(), schema]),
  );
  return schemas.map((schema) => {
    const existing = previousByName.get(schema.name.toLowerCase());
    if (existing?.status === "loaded") {
      return existing;
    }
    return {
      name: schema.name,
      status: "loaded" as const,
      errorMessage: null,
      groups: schema.groups,
      detail: "lite" as const,
    };
  });
}

export const ConnectionTreeService = new ConnectionTreeServiceImpl();
