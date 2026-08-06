import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { isTauri } from "@tauri-apps/api/core";
import type { CellRange, Column, GridApi } from "ag-grid-community";
import { ConnectionService } from "../connection/connectionService";
import {
  clearColumnLayout,
  hasSavedColumnLayout,
  loadColumnLayout,
  saveColumnLayout,
  type PersistedColumnLayoutItem,
} from "./queryResultColumnLayout";
import { toCsv, toTsv } from "./queryResultFormat";
import type { QueryResultRow } from "./queryResult";
import { QUERY_RESULT_ROW_NUMBER_COL_ID } from "./queryResult";

export type QueryResultGridSnapshot = {
  totalRows: number;
  displayedRows: number;
  filterActive: boolean;
  sortActive: boolean;
  /** True when a saved column layout exists for the current column set. */
  hasCustomLayout: boolean;
};

export type QueryResultCopyMode = "selection" | "rows" | "all";

export const DEFAULT_COLUMN_WIDTH = 140;

type ActiveGrid = {
  api: GridApi<QueryResultRow>;
  columns: string[];
  nullDisplay: string;
  profileId: string | null;
};

type SnapshotListener = () => void;

const LAYOUT_SAVE_DEBOUNCE_MS = 250;

/**
 * Holds the mounted query-result grid API so menu/keybinding commands can
 * copy/export without React context.
 */
class QueryResultGridServiceImpl {
  private active: ActiveGrid | null = null;
  private snapshot: QueryResultGridSnapshot = {
    totalRows: 0,
    displayedRows: 0,
    filterActive: false,
    sortActive: false,
    hasCustomLayout: false,
  };
  private readonly listeners = new Set<SnapshotListener>();
  /** Suppress layout persistence while applying a stored layout / reset. */
  private applyingLayout = false;
  private layoutSaveTimer: number | null = null;

  attach(
    api: GridApi<QueryResultRow>,
    columns: string[],
    nullDisplay: string,
  ): void {
    const profileId = resolveLayoutProfileId();
    this.active = { api, columns, nullDisplay, profileId };
    this.restoreColumnLayout();
    this.refreshSnapshot();
  }

  detach(api: GridApi<QueryResultRow>): void {
    if (this.active?.api === api) {
      this.flushLayoutSave();
      this.active = null;
      this.snapshot = {
        totalRows: 0,
        displayedRows: 0,
        filterActive: false,
        sortActive: false,
        hasCustomLayout: false,
      };
      this.fire();
    }
  }

  isAttached(): boolean {
    return this.active !== null;
  }

  getSnapshot(): QueryResultGridSnapshot {
    return this.snapshot;
  }

  onDidChangeSnapshot(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  refreshSnapshot(): void {
    const grid = this.active;
    if (!grid) return;

    const { api } = grid;
    let totalRows = 0;
    api.forEachNode((node) => {
      if (node.data) totalRows += 1;
    });

    let displayedRows = 0;
    api.forEachNodeAfterFilterAndSort((node) => {
      if (node.data) displayedRows += 1;
    });

    const filterActive = api.isAnyFilterPresent();
    const sortActive = (api.getColumnState() ?? []).some(
      (column) => column.sort != null,
    );

    this.snapshot = {
      totalRows,
      displayedRows,
      filterActive,
      sortActive,
      hasCustomLayout: hasSavedColumnLayout(grid.profileId, grid.columns),
    };
    this.fire();
  }

  /** Debounced persist of width / order / hide / pin (not sort/filter). */
  scheduleColumnLayoutSave(): void {
    if (this.applyingLayout || !this.active) return;
    if (this.layoutSaveTimer != null) {
      window.clearTimeout(this.layoutSaveTimer);
    }
    this.layoutSaveTimer = window.setTimeout(() => {
      this.layoutSaveTimer = null;
      this.persistColumnLayoutNow();
    }, LAYOUT_SAVE_DEBOUNCE_MS);
  }

  resetColumnLayout(): boolean {
    const grid = this.active;
    if (!grid) return false;

    // Drop pending save — do not persist the layout we are about to clear.
    this.cancelLayoutSave();
    clearColumnLayout(grid.profileId, grid.columns);

    this.applyingLayout = true;
    try {
      grid.api.resetColumnState();
      grid.api.applyColumnState({
        state: [
          {
            colId: QUERY_RESULT_ROW_NUMBER_COL_ID,
            width: 32,
            pinned: "left",
            hide: false,
            flex: null,
          },
          ...grid.columns.map((colId) => ({
            colId,
            flex: null,
            hide: false,
            pinned: null as null,
          })),
        ],
        applyOrder: true,
      });
      // Fit data columns only — keep the row-number gutter fixed width.
      grid.api.autoSizeColumns(grid.columns, false);
    } finally {
      this.applyingLayout = false;
    }

    this.refreshSnapshot();
    return true;
  }

  /**
   * Size columns to header/cell contents when no saved layout exists.
   * Safe to call after data is rendered (firstDataRendered / new result).
   */
  autoSizeToContent(): void {
    const grid = this.active;
    if (!grid || grid.columns.length === 0) return;
    if (hasSavedColumnLayout(grid.profileId, grid.columns)) return;

    this.applyingLayout = true;
    try {
      grid.api.autoSizeColumns(grid.columns, false);
    } finally {
      this.applyingLayout = false;
    }
  }

  clearFiltersAndSort(): void {
    const grid = this.active;
    if (!grid) return;
    grid.api.setFilterModel(null);
    grid.api.applyColumnState({
      defaultState: { sort: null },
    });
    this.refreshSnapshot();
  }

  async copy(mode: QueryResultCopyMode): Promise<boolean> {
    const text = this.buildTsv(mode);
    if (text === null) return false;
    await navigator.clipboard.writeText(text);
    return true;
  }

  async exportCsv(): Promise<boolean> {
    const grid = this.active;
    if (!grid) return false;

    const { columns, rows } = this.collectVisibleMatrix(grid);
    const csv = toCsv(columns, rows, grid.nullDisplay);
    const defaultName = `query-result-${formatTimestamp(new Date())}.csv`;

    if (isTauri()) {
      const path = await save({
        title: "Export CSV",
        defaultPath: defaultName,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (!path) return false;
      try {
        await writeTextFile(path, csv);
        return true;
      } catch (error) {
        console.warn(
          "[silk.queryResult.exportCsv] writeTextFile failed, falling back to download",
          error,
        );
      }
    }

    downloadTextFile(defaultName, csv, "text/csv;charset=utf-8");
    return true;
  }

  private restoreColumnLayout(): void {
    const grid = this.active;
    if (!grid || grid.columns.length === 0) return;

    const layout = loadColumnLayout(grid.profileId, grid.columns);
    if (!layout) return;

    this.applyingLayout = true;
    try {
      grid.api.applyColumnState({
        state: layout.state.map((item) => ({
          colId: item.colId,
          width: item.width ?? undefined,
          flex: item.flex ?? null,
          hide: item.hide ?? false,
          pinned: item.pinned ?? null,
        })),
        applyOrder: true,
      });
    } finally {
      this.applyingLayout = false;
    }
  }

  private persistColumnLayoutNow(): void {
    const grid = this.active;
    if (!grid || this.applyingLayout) return;

    const state = toPersistedLayoutState(grid.api.getColumnState());
    if (state.length === 0) return;
    saveColumnLayout(grid.profileId, grid.columns, state);
    this.refreshSnapshot();
  }

  private flushLayoutSave(): void {
    if (this.layoutSaveTimer != null) {
      window.clearTimeout(this.layoutSaveTimer);
      this.layoutSaveTimer = null;
      this.persistColumnLayoutNow();
    }
  }

  private cancelLayoutSave(): void {
    if (this.layoutSaveTimer != null) {
      window.clearTimeout(this.layoutSaveTimer);
      this.layoutSaveTimer = null;
    }
  }

  private buildTsv(mode: QueryResultCopyMode): string | null {
    const grid = this.active;
    if (!grid) return null;

    if (mode === "selection") {
      const cellMatrix = this.collectCellSelectionMatrix(grid);
      if (cellMatrix && cellMatrix.rows.length > 0) {
        return toTsv(cellMatrix.columns, cellMatrix.rows, grid.nullDisplay, {
          // Single cell → raw value; multi-column ranges include a header row.
          includeHeader: cellMatrix.columns.length > 1,
        });
      }
      // Fall back to selected rows, then focused row, then all visible.
      const rowMatrix = this.collectSelectedRowsMatrix(grid);
      if (rowMatrix && rowMatrix.rows.length > 0) {
        return toTsv(rowMatrix.columns, rowMatrix.rows, grid.nullDisplay);
      }
      const focused = this.collectFocusedRowMatrix(grid);
      if (focused) {
        return toTsv(focused.columns, focused.rows, grid.nullDisplay);
      }
      return this.buildTsv("all");
    }

    if (mode === "rows") {
      const selected = this.collectSelectedRowsMatrix(grid);
      if (selected && selected.rows.length > 0) {
        return toTsv(selected.columns, selected.rows, grid.nullDisplay);
      }
      const focused = this.collectFocusedRowMatrix(grid);
      if (focused) {
        return toTsv(focused.columns, focused.rows, grid.nullDisplay);
      }
      return null;
    }

    const visible = this.collectVisibleMatrix(grid);
    return toTsv(visible.columns, visible.rows, grid.nullDisplay);
  }

  private collectVisibleMatrix(grid: ActiveGrid): {
    columns: string[];
    rows: Array<Array<string | null>>;
  } {
    const columns = visibleColumnFields(grid.api, grid.columns);
    const rows: Array<Array<string | null>> = [];
    grid.api.forEachNodeAfterFilterAndSort((node) => {
      if (!node.data) return;
      rows.push(columns.map((column) => node.data?.[column] ?? null));
    });
    return { columns, rows };
  }

  private collectSelectedRowsMatrix(grid: ActiveGrid): {
    columns: string[];
    rows: Array<Array<string | null>>;
  } | null {
    const selected = grid.api.getSelectedRows();
    if (selected.length === 0) return null;
    const columns = visibleColumnFields(grid.api, grid.columns);
    const rows = selected.map((row) =>
      columns.map((column) => row[column] ?? null),
    );
    return { columns, rows };
  }

  private collectFocusedRowMatrix(grid: ActiveGrid): {
    columns: string[];
    rows: Array<Array<string | null>>;
  } | null {
    const focused = grid.api.getFocusedCell();
    if (!focused) return null;
    const node = grid.api.getDisplayedRowAtIndex(focused.rowIndex);
    if (!node?.data) return null;
    const columns = visibleColumnFields(grid.api, grid.columns);
    return {
      columns,
      rows: [columns.map((column) => node.data?.[column] ?? null)],
    };
  }

  private collectCellSelectionMatrix(grid: ActiveGrid): {
    columns: string[];
    rows: Array<Array<string | null>>;
  } | null {
    const ranges = grid.api.getCellRanges();
    if (!ranges || ranges.length === 0) return null;

    // Use the last (most recent) range — typical Excel-like behavior.
    const range = ranges[ranges.length - 1];
    const rangeColumns = columnsFromRange(range);
    const fields = rangeColumns
      .map(columnField)
      .filter((field): field is string => Boolean(field));
    if (fields.length === 0) return null;

    const rowIndexes = rowIndexesFromRange(range);
    if (rowIndexes.length === 0) return null;

    const rows: Array<Array<string | null>> = [];
    for (const rowIndex of rowIndexes) {
      const node = grid.api.getDisplayedRowAtIndex(rowIndex);
      if (!node?.data) continue;
      rows.push(fields.map((field) => node.data?.[field] ?? null));
    }

    if (rows.length === 0) return null;
    return { columns: fields, rows };
  }

  private fire(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

function resolveLayoutProfileId(): string | null {
  return (
    ConnectionService.getConnectedProfile()?.id ??
    ConnectionService.getActiveProfile()?.id ??
    null
  );
}

function toPersistedLayoutState(
  state: Array<{
    colId: string;
    width?: number | null;
    flex?: number | null;
    hide?: boolean | null;
    pinned?: "left" | "right" | boolean | null;
  }>,
): PersistedColumnLayoutItem[] {
  return state
    .filter((column) => column.colId !== QUERY_RESULT_ROW_NUMBER_COL_ID)
    .map((column) => ({
      colId: column.colId,
      width: column.width ?? null,
      flex: column.flex ?? null,
      hide: column.hide ?? false,
      pinned: column.pinned ?? null,
    }));
}

function visibleColumnFields(
  api: GridApi<QueryResultRow>,
  fallback: string[],
): string[] {
  const displayed = api.getAllDisplayedColumns();
  if (!displayed || displayed.length === 0) return fallback;
  return displayed
    .map((column) => column.getColDef().field)
    .filter((field): field is string => typeof field === "string" && field.length > 0);
}

function columnsFromRange(range: CellRange): Column[] {
  return range.columns ?? [];
}

function columnField(column: Column): string | undefined {
  const field = column.getColDef().field;
  return typeof field === "string" ? field : undefined;
}

function rowIndexesFromRange(range: CellRange): number[] {
  const start = range.startRow?.rowIndex;
  const end = range.endRow?.rowIndex;
  if (start == null || end == null) return [];
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  const indexes: number[] = [];
  for (let index = from; index <= to; index += 1) {
    indexes.push(index);
  }
  return indexes;
}

function formatTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function downloadTextFile(
  filename: string,
  content: string,
  mimeType: string,
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export const QueryResultGridService = new QueryResultGridServiceImpl();
