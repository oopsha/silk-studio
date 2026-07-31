import type {
  ConnectionMetadataResult,
  MetadataGroup,
  MetadataSchema,
} from "@silk-studio/db-protocol";
import { bridgeListMetadata } from "./connectionBridge";
import { formatErrorMessage } from "../formatErrorMessage";
import {
  filterSystemNamespaces,
  type ExplorerFilterContext,
} from "./systemNamespaces";

export type SchemaTreeNode = {
  name: string;
  status: "idle" | "loading" | "loaded" | "error";
  errorMessage: string | null;
  /** Only groups the connected database supports are present — see `MetadataGroupId`. */
  groups: MetadataGroup[];
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

class ConnectionTreeServiceImpl {
  private readonly caches = new Map<string, ProfileTreeCache>();
  private readonly listeners = new Set<TreeListener>();
  private readonly explorerFilters = new Map<string, ExplorerFilterContext>();
  private connectedProfileId: string | null = null;

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

  /** Keep in sync from ConnectionService after connect/disconnect (avoids import cycle). */
  setConnectedProfileId(profileId: string | null): void {
    if (this.connectedProfileId === profileId) return;
    this.connectedProfileId = profileId;
    for (const id of [...this.caches.keys()]) {
      if (id !== profileId) {
        this.caches.delete(id);
        this.explorerFilters.delete(id);
      }
    }
    this.fireDidChange();
  }

  invalidate(profileId?: string): void {
    if (profileId) {
      this.caches.delete(profileId);
    } else {
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
    if (this.connectedProfileId !== profileId) {
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
      const result = await bridgeListMetadata();
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
    if (this.connectedProfileId !== profileId) {
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
      const result = await bridgeListMetadata(undefined, catalogName);
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
        currentCatalog: result.currentCatalog?.trim() || catalogName,
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

  async loadSchemaObjects(
    profileId: string,
    schemaName: string,
    force = false,
    catalogName?: string,
  ): Promise<void> {
    if (this.connectedProfileId !== profileId) {
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
      );
      return;
    }

    const schema = cache.schemas.find(
      (item) => item.name.toLowerCase() === schemaName.toLowerCase(),
    );
    if (!schema) {
      throw new Error(`Schema not found: ${schemaName}`);
    }
    if (!force && (schema.status === "loaded" || schema.status === "loading")) {
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
      const result = await bridgeListMetadata(schemaName);
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
    if (!force && (schema.status === "loaded" || schema.status === "loading")) {
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
      const result = await bridgeListMetadata(schemaName, catalogName);
      const loaded = result.schemas.find(
        (item) => item.name.toLowerCase() === schemaName.toLowerCase(),
      );
      const groups = loaded?.groups ?? [];
      this.caches.set(profileId, {
        status: "loaded",
        errorMessage: null,
        currentCatalog: result.currentCatalog?.trim() || catalogName,
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

  onDidChange(listener: TreeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.listeners.clear();
    this.caches.clear();
    this.explorerFilters.clear();
    this.connectedProfileId = null;
  }

  private fireDidChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
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

export const ConnectionTreeService = new ConnectionTreeServiceImpl();
