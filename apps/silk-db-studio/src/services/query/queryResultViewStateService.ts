import type { ColumnState } from "ag-grid-community";

export type GridUiState = {
  filterModel: Record<string, unknown>;
  sortState: ColumnState[];
};

export const gridUiStateByTabId = new Map<string, GridUiState>();
export type GridViewState = {
  /** Result-wide index just past the loaded page. */
  nextOffset: number;
  /** Another page follows the loaded one. */
  hasMore: boolean;
  firstVisibleRow: number;
  lastVisibleRow: number;
  /** Paged results: zero-based page shown in the grid (defaults to 0). */
  pageIndex?: number;
  /** Paged results: rows per page — the initial fetch size (defaults to RESULT_PAGE_SIZE). */
  pageSize?: number;
};

export const gridViewStateByTabId = new Map<string, GridViewState>();

/**
 * Last `COUNT(*)` outcome per result tab, so switching editor tabs (which remounts the grid)
 * does not count again. `filterKey` is the filter it was counted with; a different filter
 * counts again. "stopped" = cancelled or failed (the grid offers a retry link).
 */
export const serverTotalByTabId = new Map<string, {
  filterKey: string;
  /** `QueryResultQueryService.getRefreshGeneration` when counted (a save/refresh recounts). */
  refreshGeneration: number;
  total: { status: "done"; count: number } | { status: "stopped" };
}>();

/** View state lives exactly as long as its result tab, including while unmounted. */
export function removeResultViewStates(tabIds: Iterable<string>): void {
  for (const tabId of tabIds) {
    gridUiStateByTabId.delete(tabId);
    gridViewStateByTabId.delete(tabId);
    serverTotalByTabId.delete(tabId);
  }
}
