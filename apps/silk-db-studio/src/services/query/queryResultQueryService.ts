import type { QueryResultPayload } from "@silk-studio/db-protocol";
import { QueryResultDirtyService } from "./queryResultDirtyService";
import { fetchQueryResultPage } from "./queryResultPaging";
import { translateFilterModel, translateSortModel } from "./filterModelTranslator";
import { gridUiStateByTabId, gridViewStateByTabId, type GridUiState } from "./queryResultViewStateService";

export const RESULT_PAGE_SIZE = 100;
const emptyUi = (): GridUiState => ({ filterModel: {}, sortState: [] });
type ResultQuery = {
  connectionId: string;
  sql: string;
  columns: string[];
  binds?: Array<string | null>;
  paged: boolean;
  /** How a paged result is browsed (fixed per result, from `queryResult.pagingMode`). Default "page". */
  pagingMode?: "page" | "scroll";
  prepare: () => Promise<void>;
  fetchInitial: () => Promise<QueryResultPayload>;
};
type Entry = ResultQuery & {
  epoch: number;
  reloading: boolean;
  appending: boolean;
  committedUi: GridUiState;
};

/** Owns read requests for a result. Only its current generation may publish rows. */
export class QueryResultQueryServiceImpl {
  private readonly entries = new Map<string, Entry>();
  private readonly paused = new Map<string, number>();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly fetchPage = fetchQueryResultPage) {}

  register(tabId: string, query: ResultQuery, rowCount: number): void {
    this.entries.set(tabId, { ...query, epoch: 0, reloading: false, appending: false, committedUi: emptyUi() });
    gridUiStateByTabId.set(tabId, emptyUi());
    // The initial fetch (maxRows) is page 1, so its size is the page size.
    gridViewStateByTabId.set(tabId, { nextOffset: rowCount, hasMore: query.paged, firstVisibleRow: 0, lastVisibleRow: 0,
      pageIndex: 0, pageSize: rowCount > 0 ? rowCount : RESULT_PAGE_SIZE });
  }

  isPaged(tabId: string): boolean { return this.entries.get(tabId)?.paged ?? false; }
  /** "scroll": rows are appended as the grid scrolls; "page": one page at a time. */
  pagingMode(tabId: string): "page" | "scroll" { return this.entries.get(tabId)?.pagingMode ?? "page"; }
  isBusy(tabId: string): boolean {
    const entry = this.entries.get(tabId);
    return !!entry && (entry.reloading || this.paused.has(entry.connectionId));
  }
  /** Scroll mode: the next block is being fetched. */
  isAppending(tabId: string): boolean { return this.entries.get(tabId)?.appending ?? false; }
  onDidChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  private fire(): void { this.listeners.forEach((listener) => listener()); }
  hasPendingEdits(connectionId: string): boolean {
    return [...this.entries].some(([id, entry]) => entry.connectionId === connectionId && QueryResultDirtyService.hasPendingChanges(id));
  }
  removeTabs(tabIds: Iterable<string>): void { for (const id of tabIds) this.entries.delete(id); }

  pauseConnection(connectionId: string): () => void {
    this.paused.set(connectionId, (this.paused.get(connectionId) ?? 0) + 1);
    for (const entry of this.entries.values()) {
      if (entry.connectionId === connectionId) {
        entry.epoch++;
        entry.reloading = false;
        entry.appending = false;
      }
    }
    this.fire();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const count = (this.paused.get(connectionId) ?? 1) - 1;
      if (count === 0) this.paused.delete(connectionId);
      else this.paused.set(connectionId, count);
      this.fire();
    };
  }

  private current(tabId: string, entry: Entry, epoch: number): boolean {
    return this.entries.get(tabId) === entry && entry.epoch === epoch && !this.paused.has(entry.connectionId);
  }

  private options(entry: Entry, ui: GridUiState) {
    return {
      binds: entry.binds,
      filters: translateFilterModel(ui.filterModel, entry.columns),
      sort: translateSortModel(ui.sortState
        .filter((column) => column.sort === "asc" || column.sort === "desc")
        .sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0))
        .map((column) => ({ colId: column.colId, sort: column.sort! })), entry.columns),
    };
  }

  /**
   * Re-fetches the shown page. A new filter/sort (`nextUi`) returns to the first page; a plain
   * refresh (after save, rollback…) stays on the current one.
   */
  reload(tabId: string, nextUi?: GridUiState): Promise<QueryResultPayload | null> {
    return this.load(tabId, nextUi, undefined);
  }

  /** Paged results: shows page `pageIndex` (zero-based) with the committed filter/sort. */
  goToPage(tabId: string, pageIndex: number): Promise<QueryResultPayload | null> {
    return this.load(tabId, undefined, Math.max(0, Math.floor(pageIndex)));
  }

  private async load(tabId: string, nextUi: GridUiState | undefined, requestedPage: number | undefined): Promise<QueryResultPayload | null> {
    const entry = this.entries.get(tabId);
    if (!entry || this.paused.has(entry.connectionId)) return null;
    const epoch = ++entry.epoch;
    entry.reloading = true;
    entry.appending = false;
    const revision = QueryResultDirtyService.getRevision(tabId);
    this.fire();
    const ui = structuredClone(nextUi ?? gridUiStateByTabId.get(tabId) ?? entry.committedUi);
    gridUiStateByTabId.set(tabId, ui);
    const view = gridViewStateByTabId.get(tabId)!;
    try {
      await entry.prepare();
      if (!this.current(tabId, entry, epoch)) return null;
      let payload: QueryResultPayload;
      let hasMore = false;
      let pageSize = view.pageSize ?? RESULT_PAGE_SIZE;
      let pageIndex = requestedPage ?? (nextUi ? 0 : view.pageIndex ?? 0);
      if (entry.paged && entry.pagingMode === "scroll") {
        // Scroll mode: re-read every loaded block from the top (at least what was on screen).
        const rows: Array<Array<string | null>> = [];
        const lobTruncated: boolean[][] = [];
        let hasLobMetadata = false;
        const target = Math.max(view.nextOffset, view.lastVisibleRow + 1, pageSize);
        let last: QueryResultPayload | null = null;
        do {
          last = await this.fetchPage(entry.connectionId, entry.sql, entry.columns,
            rows.length, pageSize, this.options(entry, ui));
          if (!this.current(tabId, entry, epoch)) return null;
          if (last.lobTruncated) hasLobMetadata = true;
          last.rows.forEach((_, index) => lobTruncated.push(last!.lobTruncated?.[index] ?? []));
          rows.push(...last.rows);
          hasMore = morePagesFollow(last, pageSize);
        } while (hasMore && rows.length < target);
        payload = { ...last!, rows, rowCount: rows.length, truncated: hasMore,
          lobTruncated: hasLobMetadata ? lobTruncated : undefined };
        pageIndex = 0;
      } else if (entry.paged) {
        const fetchAt = (index: number) => this.fetchPage(entry.connectionId, entry.sql, entry.columns,
          index * pageSize, pageSize, this.options(entry, ui));
        payload = await fetchAt(pageIndex);
        if (!this.current(tabId, entry, epoch)) return null;
        // The page vanished (rows deleted, narrower filter): fall back to the first page.
        if (payload.rows.length === 0 && pageIndex > 0) {
          pageIndex = 0;
          payload = await fetchAt(0);
          if (!this.current(tabId, entry, epoch)) return null;
        }
        // The agent reads limit+1 rows and reports `truncated` when another page follows.
        hasMore = morePagesFollow(payload, pageSize);
        payload = { ...payload, rowCount: payload.rows.length, truncated: hasMore };
      } else {
        payload = await entry.fetchInitial();
        if (!this.current(tabId, entry, epoch)) return null;
        hasMore = payload.truncated === true;
        pageIndex = 0;
        if (hasMore) {
          entry.paged = true;
          pageSize = Math.max(1, payload.rows.length);
        }
      }
      if (payload.kind !== "resultSet") throw new Error("The refreshed query no longer returns rows.");
      if (QueryResultDirtyService.getRevision(tabId) !== revision) throw new Error("Grid edits changed while reloading. Reload was discarded.");
      entry.columns = payload.columns;
      entry.committedUi = ui;
      const offset = pageIndex * pageSize;
      const samePage = entry.pagingMode === "scroll" ||
        (requestedPage === undefined && !nextUi && pageIndex === (view.pageIndex ?? 0));
      gridViewStateByTabId.set(tabId, {
        nextOffset: offset + payload.rows.length, hasMore, pageIndex, pageSize,
        firstVisibleRow: samePage && view.firstVisibleRow < payload.rows.length ? view.firstVisibleRow : 0,
        lastVisibleRow: samePage ? Math.min(view.lastVisibleRow, Math.max(0, payload.rows.length - 1)) : 0,
      });
      QueryResultDirtyService.replaceOriginalRows(tabId, payload.columns, payload.rows, offset);
      return payload;
    } catch (error) {
      if (!this.current(tabId, entry, epoch)) return null;
      gridUiStateByTabId.set(tabId, entry.paged ? entry.committedUi : ui);
      throw error;
    } finally {
      if (this.current(tabId, entry, epoch)) { entry.reloading = false; this.fire(); }
    }
  }

  /** Scroll mode: appends the next block of rows after the loaded ones. */
  async append(tabId: string): Promise<void> {
    const entry = this.entries.get(tabId);
    const view = gridViewStateByTabId.get(tabId);
    if (!entry || entry.pagingMode !== "scroll" || !view?.hasMore || !entry.paged || entry.reloading ||
      entry.appending || this.paused.has(entry.connectionId)) return;
    const epoch = entry.epoch;
    const offset = view.nextOffset;
    // Each block is `queryResult.maxRows` rows — the size of the initial fetch.
    const blockSize = view.pageSize ?? RESULT_PAGE_SIZE;
    entry.appending = true;
    this.fire();
    try {
      await entry.prepare();
      if (!this.current(tabId, entry, epoch)) return;
      const payload = await this.fetchPage(entry.connectionId, entry.sql, entry.columns,
        offset, blockSize, this.options(entry, entry.committedUi));
      if (!this.current(tabId, entry, epoch)) return;
      const currentView = gridViewStateByTabId.get(tabId)!;
      gridViewStateByTabId.set(tabId, { ...currentView,
        nextOffset: offset + payload.rows.length, hasMore: morePagesFollow(payload, blockSize) });
      QueryResultDirtyService.appendOriginalRows(tabId, offset, payload.columns, payload.rows);
    } catch (error) {
      if (this.current(tabId, entry, epoch)) throw error;
    } finally {
      if (this.current(tabId, entry, epoch)) { entry.appending = false; this.fire(); }
    }
  }

  /**
   * Abandons a running scroll append (its rows are discarded when they arrive). Returns the
   * connection whose running statement the caller should cancel, or null if nothing was running.
   */
  cancelAppend(tabId: string): string | null {
    const entry = this.entries.get(tabId);
    if (!entry?.appending) return null;
    entry.epoch++;
    entry.appending = false;
    this.fire();
    return entry.connectionId;
  }
}

/** The agent reads limit+1 rows and reports `truncated` when another block follows. */
function morePagesFollow(payload: QueryResultPayload, size: number): boolean {
  return payload.truncated === true || (payload.truncated === undefined && payload.rows.length >= size);
}

export const QueryResultQueryService = new QueryResultQueryServiceImpl();
