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
    gridViewStateByTabId.set(tabId, { nextOffset: rowCount, hasMore: query.paged, firstVisibleRow: 0, lastVisibleRow: 0 });
  }

  isPaged(tabId: string): boolean { return this.entries.get(tabId)?.paged ?? false; }
  isBusy(tabId: string): boolean {
    const entry = this.entries.get(tabId);
    return !!entry && (entry.reloading || this.paused.has(entry.connectionId));
  }
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

  async reload(tabId: string, nextUi?: GridUiState): Promise<QueryResultPayload | null> {
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
      if (entry.paged) {
        const rows: Array<Array<string | null>> = [];
        const lobTruncated: boolean[][] = [];
        let hasLobMetadata = false;
        const target = Math.max(view.nextOffset, view.lastVisibleRow + 1, RESULT_PAGE_SIZE);
        let last: QueryResultPayload | null = null;
        do {
          last = await this.fetchPage(entry.connectionId, entry.sql, entry.columns,
            rows.length, RESULT_PAGE_SIZE, this.options(entry, ui));
          if (!this.current(tabId, entry, epoch)) return null;
          if (last.lobTruncated) hasLobMetadata = true;
          last.rows.forEach((_, index) => lobTruncated.push(last!.lobTruncated?.[index] ?? []));
          rows.push(...last.rows);
          hasMore = last.rows.length === RESULT_PAGE_SIZE;
        } while (hasMore && rows.length < target);
        payload = { ...last!, rows, rowCount: rows.length, truncated: hasMore,
          lobTruncated: hasLobMetadata ? lobTruncated : undefined };
      } else {
        payload = await entry.fetchInitial();
        if (!this.current(tabId, entry, epoch)) return null;
        hasMore = payload.truncated === true;
        if (hasMore) entry.paged = true;
      }
      if (payload.kind !== "resultSet") throw new Error("The refreshed query no longer returns rows.");
      if (QueryResultDirtyService.getRevision(tabId) !== revision) throw new Error("Grid edits changed while reloading. Reload was discarded.");
      entry.columns = payload.columns;
      entry.committedUi = ui;
      gridViewStateByTabId.set(tabId, {
        nextOffset: payload.rows.length, hasMore,
        firstVisibleRow: view.firstVisibleRow < payload.rows.length ? view.firstVisibleRow : 0,
        lastVisibleRow: Math.min(view.lastVisibleRow, Math.max(0, payload.rows.length - 1)),
      });
      QueryResultDirtyService.replaceOriginalRows(tabId, payload.columns, payload.rows);
      return payload;
    } catch (error) {
      if (!this.current(tabId, entry, epoch)) return null;
      gridUiStateByTabId.set(tabId, entry.paged ? entry.committedUi : ui);
      throw error;
    } finally {
      if (this.current(tabId, entry, epoch)) { entry.reloading = false; this.fire(); }
    }
  }

  async append(tabId: string): Promise<void> {
    const entry = this.entries.get(tabId);
    const view = gridViewStateByTabId.get(tabId);
    if (!entry || !view?.hasMore || !entry.paged || entry.reloading || entry.appending || this.paused.has(entry.connectionId)) return;
    const epoch = entry.epoch;
    const offset = view.nextOffset;
    entry.appending = true;
    try {
      await entry.prepare();
      if (!this.current(tabId, entry, epoch)) return;
      const payload = await this.fetchPage(entry.connectionId, entry.sql, entry.columns,
        offset, RESULT_PAGE_SIZE, this.options(entry, entry.committedUi));
      if (!this.current(tabId, entry, epoch)) return;
      const currentView = gridViewStateByTabId.get(tabId)!;
      gridViewStateByTabId.set(tabId, { ...currentView,
        nextOffset: offset + payload.rows.length, hasMore: payload.rows.length === RESULT_PAGE_SIZE });
      QueryResultDirtyService.appendOriginalRows(tabId, offset, payload.columns, payload.rows);
    } catch (error) {
      if (this.current(tabId, entry, epoch)) throw error;
    } finally {
      if (this.current(tabId, entry, epoch)) entry.appending = false;
    }
  }
}

export const QueryResultQueryService = new QueryResultQueryServiceImpl();
