import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { isTauri } from "@tauri-apps/api/core";
import type { GridApi } from "ag-grid-community";
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
  /** True when the user changed layout since last save/reset/restore. */
  layoutDirty: boolean;
};

export type QueryResultCopyMode = "selection" | "rows" | "all";

export const DEFAULT_COLUMN_WIDTH = 140;

type ActiveGrid = {
  api: GridApi<QueryResultRow>;
  columns: string[];
  nullDisplay: string;
  profileId: string | null;
  cellSelection: {
    columns: string[];
    startRowIndex: number;
    endRowIndex: number;
  } | null;
  openValueEditor: () => void;
};

type SnapshotListener = () => void;

/** Ignore column events briefly after programmatic layout/autosize. */
const APPLYING_LAYOUT_CLEAR_MS = 120;

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
    layoutDirty: false,
  };
  private readonly listeners = new Set<SnapshotListener>();
  /** Suppress dirty marks while applying a stored layout / reset / autosize. */
  private applyingLayout = false;
  private applyingLayoutClearTimer: number | null = null;
  private layoutDirty = false;

  attach(
    api: GridApi<QueryResultRow>,
    columns: string[],
    nullDisplay: string,
    openValueEditor: () => void,
  ): void {
    const profileId = resolveLayoutProfileId();
    this.active = { api, columns, nullDisplay, profileId, cellSelection: null, openValueEditor };
    this.layoutDirty = false;
    this.restoreColumnLayout();
    this.refreshSnapshot();
  }

  detach(api: GridApi<QueryResultRow>): void {
    if (this.active?.api === api) {
      this.cancelApplyingLayoutClear();
      this.active = null;
      this.layoutDirty = false;
      this.applyingLayout = false;
      this.snapshot = {
        totalRows: 0,
        displayedRows: 0,
        filterActive: false,
        sortActive: false,
        hasCustomLayout: false,
        layoutDirty: false,
      };
      this.fire();
    }
  }

  isAttached(): boolean {
    return this.active !== null;
  }

  openValueEditor(): void {
    this.active?.openValueEditor();
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
      layoutDirty: this.layoutDirty,
    };
    this.fire();
  }

  /** Mark layout dirty after a user-driven column change (no auto-save). */
  markColumnLayoutDirty(): void {
    if (this.applyingLayout || !this.active || this.layoutDirty) return;
    this.layoutDirty = true;
    this.refreshSnapshot();
  }

  /** Persist current column layout explicitly (toolbar / command). */
  saveColumnLayoutNow(): boolean {
    const grid = this.active;
    if (!grid || this.applyingLayout) return false;

    const state = toPersistedLayoutState(grid.api.getColumnState());
    if (state.length === 0) return false;
    saveColumnLayout(grid.profileId, grid.columns, state);
    this.layoutDirty = false;
    this.refreshSnapshot();
    return true;
  }

  resetColumnLayout(): boolean {
    const grid = this.active;
    if (!grid) return false;

    const hadSaved = hasSavedColumnLayout(grid.profileId, grid.columns);
    if (!hadSaved && !this.layoutDirty) return false;

    clearColumnLayout(grid.profileId, grid.columns);
    this.layoutDirty = false;
    this.beginApplyingLayout();
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
      this.endApplyingLayout({ keepClean: true });
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

    this.autoSizeAllColumns();
  }

  /** Explicit user action: size every result column even when a layout is saved. */
  autoSizeAllColumns(): void {
    const grid = this.active;
    if (!grid || grid.columns.length === 0) return;

    this.beginApplyingLayout();
    try {
      grid.api.autoSizeColumns(grid.columns, false);
    } finally {
      this.endApplyingLayout({ keepClean: true });
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

  setCellSelection(
    columns: string[],
    startRowIndex: number,
    endRowIndex: number,
  ): void {
    if (!this.active) return;
    this.active.cellSelection = {
      columns,
      startRowIndex,
      endRowIndex,
    };
  }

  clearCellSelection(): void {
    if (!this.active) return;
    this.active.cellSelection = null;
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

    this.layoutDirty = false;
    this.beginApplyingLayout();
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
      this.endApplyingLayout({ keepClean: true });
    }
  }

  private beginApplyingLayout(): void {
    this.cancelApplyingLayoutClear();
    this.applyingLayout = true;
  }

  private endApplyingLayout(options?: { keepClean?: boolean }): void {
    this.cancelApplyingLayoutClear();
    this.applyingLayoutClearTimer = window.setTimeout(() => {
      this.applyingLayoutClearTimer = null;
      this.applyingLayout = false;
      if (options?.keepClean) {
        this.layoutDirty = false;
        this.refreshSnapshot();
      }
    }, APPLYING_LAYOUT_CLEAR_MS);
  }

  private cancelApplyingLayoutClear(): void {
    if (this.applyingLayoutClearTimer != null) {
      window.clearTimeout(this.applyingLayoutClearTimer);
      this.applyingLayoutClearTimer = null;
    }
  }

  private buildTsv(mode: QueryResultCopyMode): string | null {
    const grid = this.active;
    if (!grid) return null;

    if (mode === "selection") {
      const cellMatrix = this.collectCellSelectionMatrix(grid);
      if (cellMatrix && cellMatrix.rows.length > 0) {
        return toTsv(cellMatrix.columns, cellMatrix.rows, grid.nullDisplay, {
          // Cell copy mirrors spreadsheet behavior: values only, never headers.
          includeHeader: false,
        });
      }
      const focusedCell = this.collectFocusedCellMatrix(grid);
      return focusedCell
        ? toTsv(focusedCell.columns, focusedCell.rows, grid.nullDisplay, {
            includeHeader: false,
          })
        : null;
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

  /** Return exactly the focused cell when no drag/range selection exists. */
  private collectFocusedCellMatrix(grid: ActiveGrid): {
    columns: string[];
    rows: Array<Array<string | null>>;
  } | null {
    const focused = grid.api.getFocusedCell();
    if (!focused) return null;

    const field = focused.column.getColDef().field;
    if (typeof field !== "string" || field.length === 0) return null;

    const node = grid.api.getDisplayedRowAtIndex(focused.rowIndex);
    if (!node?.data) return null;

    return {
      columns: [field],
      rows: [[node.data[field] ?? null]],
    };
  }

  private collectCellSelectionMatrix(grid: ActiveGrid): {
    columns: string[];
    rows: Array<Array<string | null>>;
  } | null {
    const selection = grid.cellSelection;
    if (!selection || selection.columns.length === 0) return null;
    const from = Math.min(selection.startRowIndex, selection.endRowIndex);
    const to = Math.max(selection.startRowIndex, selection.endRowIndex);

    const rows: Array<Array<string | null>> = [];
    for (let rowIndex = from; rowIndex <= to; rowIndex += 1) {
      const node = grid.api.getDisplayedRowAtIndex(rowIndex);
      if (!node?.data) continue;
      rows.push(selection.columns.map((field) => node.data?.[field] ?? null));
    }

    if (rows.length === 0) return null;
    return { columns: selection.columns, rows };
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
