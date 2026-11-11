import type { ColumnState } from "ag-grid-community";

export type GridUiState = {
  filterModel: Record<string, unknown>;
  sortState: ColumnState[];
};

export const gridUiStateByTabId = new Map<string, GridUiState>();
export const gridViewStateByTabId = new Map<string, {
  nextOffset: number;
  hasMore: boolean;
  firstVisibleRow: number;
  lastVisibleRow: number;
}>();

/** View state lives exactly as long as its result tab, including while unmounted. */
export function removeResultViewStates(tabIds: Iterable<string>): void {
  for (const tabId of tabIds) {
    gridUiStateByTabId.delete(tabId);
    gridViewStateByTabId.delete(tabId);
  }
}
