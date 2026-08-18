import { ConfigurationService } from "@silk-studio/workbench/platform/configuration/configurationService.ts";
import { ConnectionService } from "./connectionService";
import { ConnectionTreeService } from "./connectionTreeService";

/**
 * Roughly 200 bytes/object (see settings description) × this cap keeps worst-case memory in
 * the tens-of-MB range even on legacy/ERP instances with thousands of tables per schema.
 */
const MAX_PREFETCH_OBJECTS = 300_000;
const CONCURRENCY = 3;

async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  async function next(): Promise<void> {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      await worker(current);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => next()),
  );
}

/**
 * Background-loads every database/schema/object name for a connected profile so Ctrl+Shift+O
 * can match `db.schema.object` even on databases never expanded in Explorer. Gated by
 * `explorer.search.prefetchAllDatabases` (off by default — see the setting's description for
 * the memory tradeoff). Never switches the shared session's current catalog — it only calls
 * ConnectionTreeService's catalog-scoped read paths (see connectionTreeService.ts, 4단계).
 */
class ExplorerSearchPrefetchServiceImpl {
  private started = false;
  private readonly attempted = new Set<string>();
  private previouslyConnected = new Set<string>();

  start(): void {
    if (this.started) return;
    this.started = true;
    this.previouslyConnected = new Set(
      ConnectionService.getState().connectedProfileIds,
    );

    ConnectionService.onDidChange(() => {
      const nowConnected = new Set(
        ConnectionService.getState().connectedProfileIds,
      );

      for (const profileId of this.previouslyConnected) {
        if (!nowConnected.has(profileId)) {
          // Disconnected — allow a future reconnect to retry from scratch.
          this.attempted.delete(profileId);
        }
      }
      this.previouslyConnected = nowConnected;

      if (!ConfigurationService.getValue("explorer.search.prefetchAllDatabases")) {
        return;
      }
      for (const profileId of nowConnected) {
        if (this.attempted.has(profileId)) continue;
        this.attempted.add(profileId);
        void this.prefetch(profileId);
      }
    });
  }

  private isLive(profileId: string): boolean {
    return ConnectionService.isConnected(profileId);
  }

  private countLoadedObjects(profileId: string): number {
    const cache = ConnectionTreeService.getCache(profileId);
    const schemaLists =
      cache.catalogs.length > 0
        ? cache.catalogs.flatMap((catalog) => catalog.schemas)
        : cache.schemas;
    let total = 0;
    for (const schema of schemaLists) {
      if (schema.status !== "loaded") continue;
      for (const group of schema.groups) {
        total += group.objects.length;
      }
    }
    return total;
  }

  private async loadSchema(
    profileId: string,
    schemaName: string,
    catalogName: string | undefined,
  ): Promise<void> {
    if (!this.isLive(profileId)) return;
    if (this.countLoadedObjects(profileId) >= MAX_PREFETCH_OBJECTS) return;
    try {
      await ConnectionTreeService.loadSchemaObjects(
        profileId,
        schemaName,
        false,
        catalogName,
      );
    } catch {
      // Best-effort — a failed schema just stays unsearchable until manually retried.
    }
  }

  private async prefetch(profileId: string): Promise<void> {
    try {
      await ConnectionTreeService.loadSchemas(profileId);
    } catch {
      return;
    }
    if (!this.isLive(profileId)) return;

    const cache = ConnectionTreeService.getCache(profileId);

    if (cache.catalogs.length === 0) {
      const schemaNames = cache.schemas.map((schema) => schema.name);
      await runWithConcurrency(schemaNames, CONCURRENCY, (schemaName) =>
        this.loadSchema(profileId, schemaName, undefined),
      );
      return;
    }

    for (const catalog of cache.catalogs) {
      if (!this.isLive(profileId)) return;
      if (this.countLoadedObjects(profileId) >= MAX_PREFETCH_OBJECTS) return;
      try {
        await ConnectionTreeService.loadCatalogSchemas(profileId, catalog.name);
      } catch {
        continue;
      }
      if (!this.isLive(profileId)) return;
      const latest = ConnectionTreeService.getCache(profileId).catalogs.find(
        (item) => item.name.toLowerCase() === catalog.name.toLowerCase(),
      );
      const schemaNames = latest?.schemas.map((schema) => schema.name) ?? [];
      await runWithConcurrency(schemaNames, CONCURRENCY, (schemaName) =>
        this.loadSchema(profileId, schemaName, catalog.name),
      );
    }
  }
}

export const ExplorerSearchPrefetchService = new ExplorerSearchPrefetchServiceImpl();
