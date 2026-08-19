import { ConfigurationService } from "@silk-studio/workbench/platform/configuration/configurationService.ts";
import { ConnectionService } from "./connectionService";
import { ConnectionTreeService } from "./connectionTreeService";

/**
 * Roughly 200 bytes/object (see settings description) × this cap keeps worst-case memory in
 * the tens-of-MB range even on legacy/ERP instances with thousands of tables per schema.
 */
const MAX_PREFETCH_OBJECTS = 300_000;

export async function runWithConcurrency<T>(
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
 *
 * One `ConnectionTreeService.prefetchCatalog` call covers a whole catalog's schemas in a single
 * round trip (jdbc-agent's `connection.prefetchCatalog` loops schemas server-side) — this used
 * to be one `loadSchemaObjects` call (one Tauri `invoke()`) per *schema*, which on an instance
 * with dozens of catalogs × many schemas fired hundreds of `invoke()` calls in a burst right
 * after connect. That was confirmed (by elimination testing, in production use over an SSM
 * tunnel) to saturate WebView2's IPC/message pump on Windows badly enough to delay keyboard
 * input app-wide for the whole burst — a call-*count* problem, not a call-rate one, so no
 * amount of client-side throttling (concurrency limits, artificial delays — both tried) fully
 * fixed it. Collapsing to one call per catalog is what actually removes the cause.
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

    const maybeStart = () => {
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
    };

    // Two triggers: a profile connecting, or the setting being turned on for profiles that
    // are already connected (toggling it on mid-session used to do nothing until reconnect).
    ConnectionService.onDidChange(maybeStart);
    ConfigurationService.onDidChange(maybeStart);
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

  private async prefetch(profileId: string): Promise<void> {
    try {
      await ConnectionTreeService.loadSchemas(profileId);
    } catch {
      return;
    }
    if (!this.isLive(profileId)) return;

    const cache = ConnectionTreeService.getCache(profileId);

    if (cache.catalogs.length === 0) {
      try {
        await ConnectionTreeService.prefetchCatalog(
          profileId,
          undefined,
          MAX_PREFETCH_OBJECTS,
        );
      } catch {
        // Best-effort — a failed prefetch just leaves this profile unsearchable until a
        // manual Explorer expand.
      }
      return;
    }

    for (const catalog of cache.catalogs) {
      if (!this.isLive(profileId)) return;
      if (this.countLoadedObjects(profileId) >= MAX_PREFETCH_OBJECTS) return;
      try {
        await ConnectionTreeService.prefetchCatalog(
          profileId,
          catalog.name,
          MAX_PREFETCH_OBJECTS,
        );
      } catch {
        // Best-effort — a failed catalog just stays unsearchable until manually loaded.
      }
    }
  }
}

export const ExplorerSearchPrefetchService = new ExplorerSearchPrefetchServiceImpl();
