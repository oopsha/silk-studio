import type {
  ConnectionMetadataResult,
  MetadataGroup,
  MetadataSchema,
} from "@silk-studio/db-protocol";
import { bridgeListMetadata } from "./connectionBridge";
import { formatErrorMessage } from "../formatErrorMessage";

export type SchemaTreeNode = {
  name: string;
  status: "idle" | "loading" | "loaded" | "error";
  errorMessage: string | null;
  /** Only groups the connected database supports are present — see `MetadataGroupId`. */
  groups: MetadataGroup[];
};

export type ProfileTreeCache = {
  status: "idle" | "loading" | "loaded" | "error";
  errorMessage: string | null;
  schemas: SchemaTreeNode[];
};

type TreeListener = () => void;

class ConnectionTreeServiceImpl {
  private readonly caches = new Map<string, ProfileTreeCache>();
  private readonly listeners = new Set<TreeListener>();
  private connectedProfileId: string | null = null;

  getCache(profileId: string): ProfileTreeCache {
    return (
      this.caches.get(profileId) ?? {
        status: "idle",
        errorMessage: null,
        schemas: [],
      }
    );
  }

  /** Keep in sync from ConnectionService after connect/disconnect (avoids import cycle). */
  setConnectedProfileId(profileId: string | null): void {
    if (this.connectedProfileId === profileId) return;
    this.connectedProfileId = profileId;
    for (const id of [...this.caches.keys()]) {
      if (id !== profileId) {
        this.caches.delete(id);
      }
    }
    this.fireDidChange();
  }

  invalidate(profileId?: string): void {
    if (profileId) {
      this.caches.delete(profileId);
    } else {
      this.caches.clear();
    }
    this.fireDidChange();
  }

  /**
   * Clear cached objects for one schema so the next expand / refresh reloads them.
   * Does not remove the schema from the list.
   */
  invalidateSchema(profileId: string, schemaName: string): void {
    const cache = this.caches.get(profileId);
    if (!cache) return;

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
  ): Promise<void> {
    await this.loadSchemaObjects(profileId, schemaName, true);
  }

  /**
   * Drop one schema's object cache, then reload it.
   * Prefer this after DDL mutations (6-E) so the tree matches the database.
   */
  async invalidateAndRefreshSchema(
    profileId: string,
    schemaName: string,
  ): Promise<void> {
    this.invalidateSchema(profileId, schemaName);
    await this.loadSchemaObjects(profileId, schemaName, true);
  }

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
      schemas: current.schemas,
    });
    this.fireDidChange();

    try {
      const result = await bridgeListMetadata();
      this.caches.set(profileId, {
        status: "loaded",
        errorMessage: null,
        schemas: toSchemaNodes(result, current.schemas),
      });
      this.fireDidChange();
    } catch (error) {
      this.caches.set(profileId, {
        status: "error",
        errorMessage: formatErrorMessage(error, "Failed to load schemas."),
        schemas: [],
      });
      this.fireDidChange();
      throw error;
    }
  }

  async loadSchemaObjects(
    profileId: string,
    schemaName: string,
    force = false,
  ): Promise<void> {
    if (this.connectedProfileId !== profileId) {
      throw new Error("Connect this profile before loading database objects.");
    }

    const cache = this.getCache(profileId);
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

  onDidChange(listener: TreeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.listeners.clear();
    this.caches.clear();
    this.connectedProfileId = null;
  }

  private fireDidChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
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
