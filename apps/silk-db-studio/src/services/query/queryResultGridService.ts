import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { isTauri } from "@tauri-apps/api/core";
import type { GridApi } from "ag-grid-community";
import { EditorGroupsService } from "@silk-studio/editor/services/editor/editorGroupsService.ts";
import type { EditorGroupId } from "@silk-studio/editor/services/editor/editorGroupTypes.ts";
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
    /** Ctrl+A: every displayed row, including rows loaded after the selection was made. */
    all?: boolean;
  } | null;
  openValueEditor: () => void;
  /** Server-side streaming of the whole result into a file (large paged results). */
  streamExport?: StreamExport;
};

export type ExportFormat = "csv" | "xlsx";

export type StreamExport = {
  /**
   * Unsaved grid edits exist. Exports read the database, which does not have them yet, so both
   * CSV and Excel are refused until the edits are saved or discarded.
   */
  hasPendingChanges: () => boolean;
  /** The server-side stream can produce this format (Excel always; CSV for paged results). */
  canRun: (format: ExportFormat) => boolean;
  run: (request: {
    format: ExportFormat;
    path: string;
    columns: string[];
    signal?: AbortSignal;
    onProgress?: (rowCount: number) => void;
  }) => Promise<{ rowCount: number; cancelled: boolean }>;
};

type SnapshotListener = () => void;

/**
 * AG Grid's auto-size measures cloned header cells inside the body row container, which AG Grid
 * hides (`display: none`) while the result has no rows — every column then measures 0 and collapses
 * to its minWidth with truncated headers. For empty results, size from the rendered header text.
 */
function fitHeaderWidths(
  api: GridApi<QueryResultRow>,
  columns: string[],
  gridRoot: HTMLElement,
): void {
  const canvas = document.createElement("canvas").getContext("2d");
  if (!canvas) return;

  const wanted = new Map<string, number>();
  gridRoot.querySelectorAll<HTMLElement>(".ag-header-cell[col-id]").forEach((cell) => {
    const colId = cell.getAttribute("col-id");
    const text = cell.querySelector<HTMLElement>(".ag-header-cell-text");
    if (!colId || !text || !columns.includes(colId)) return;
    const style = getComputedStyle(text);
    canvas.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const label = cell.querySelector<HTMLElement>(".ag-header-cell-label");
    if (!label) return;
    // Everything in the cell that is not the text: cell padding plus sort/menu icons. The label
    // itself stretches to the column width, so its free space must not count as chrome.
    let others = 0;
    for (const child of Array.from(label.children) as HTMLElement[]) {
      if (child !== text) others += child.offsetWidth;
    }
    const chrome = cell.offsetWidth - label.offsetWidth + others;
    // 20 = AG Grid's default `autoSizePadding`, so empty and non-empty results size alike.
    wanted.set(colId, Math.ceil(canvas.measureText(text.textContent ?? "").width) + chrome + 20);
  });

  const state = [...wanted].map(([colId, width]) => {
    const column = api.getColumn(colId);
    const min = column?.getMinWidth() ?? 0;
    const max = column?.getMaxWidth() ?? Number.MAX_SAFE_INTEGER;
    return { colId, width: Math.min(max, Math.max(min, width)) };
  });
  if (state.length > 0) api.applyColumnState({ state });
}

/** Ignore column events briefly after programmatic layout/autosize. */
const APPLYING_LAYOUT_CLEAR_MS = 120;

/**
 * Owns exactly one rendered grid, including its selection, layout and statistics.
 */
export class QueryResultGridController {
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
    profileId: string | null = null,
    streamExport?: StreamExport,
  ): void {
    const previous = this.active;
    if (previous?.api === api && previous.profileId === profileId &&
      previous.columns.length === columns.length && previous.columns.every((column, i) => column === columns[i])) {
      Object.assign(previous, { columns, nullDisplay, openValueEditor, streamExport });
      this.refreshSnapshot();
      return;
    }
    this.active = { api, columns, nullDisplay, profileId, cellSelection: null, openValueEditor, streamExport };
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
    return this.active !== null && !this.active.api.isDestroyed();
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
  autoSizeToContent(gridRoot?: HTMLElement | null): void {
    const grid = this.active;
    if (!grid || grid.columns.length === 0) return;
    if (this.layoutDirty) return;
    if (hasSavedColumnLayout(grid.profileId, grid.columns)) return;

    this.autoSizeAllColumns(gridRoot);
  }

  /**
   * Explicit user action: size every result column even when a layout is saved.
   * `gridRoot` enables the empty-result header fallback (see `fitHeaderWidths`).
   */
  autoSizeAllColumns(gridRoot?: HTMLElement | null): void {
    const grid = this.active;
    if (!grid || grid.columns.length === 0) return;

    this.beginApplyingLayout();
    try {
      if (gridRoot && !this.hasDataRows(grid)) {
        // AG Grid's own pass can run later (asynchronously) and would overwrite this.
        fitHeaderWidths(grid.api, grid.columns, gridRoot);
      } else {
        grid.api.autoSizeColumns(grid.columns, false);
      }
    } finally {
      this.endApplyingLayout({ keepClean: true });
    }
  }

  private hasDataRows(grid: ActiveGrid): boolean {
    let found = false;
    grid.api.forEachNode((node) => {
      if (node.data) found = true;
    });
    return found;
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

  /** Ctrl+A: selects every displayed row across the visible columns (grid order). */
  selectAllCells(): string[] | null {
    const grid = this.active;
    if (!grid) return null;
    const count = grid.api.getDisplayedRowCount();
    if (count === 0) return null;
    const columns = visibleColumnFields(grid.api, grid.columns);
    grid.cellSelection = { columns, startRowIndex: 0, endRowIndex: count - 1, all: true };
    return columns;
  }

  /** Visible columns of a Ctrl+A selection, or null when the selection is a narrower range. */
  allCellsSelectionColumns(): string[] | null {
    const selection = this.active?.cellSelection;
    return selection?.all ? selection.columns : null;
  }

  /** Loaded rows the current Ctrl+A selection would copy. */
  displayedRowCount(): number {
    return this.active?.api.getDisplayedRowCount() ?? 0;
  }

  async exportCsv(
    onProgress?: (rowCount: number | null) => void,
    signal?: AbortSignal,
  ): Promise<boolean> {
    return this.exportFile("csv", onProgress, signal);
  }

  async exportXlsx(
    onProgress?: (rowCount: number | null) => void,
    signal?: AbortSignal,
  ): Promise<boolean> {
    return this.exportFile("xlsx", onProgress, signal);
  }

  private async exportFile(
    format: ExportFormat,
    onProgress?: (rowCount: number | null) => void,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const grid = this.active;
    if (!grid) return false;
    // The database does not have unsaved edits yet; exporting would silently drop them.
    if (grid.streamExport?.hasPendingChanges()) return false;

    const visible = this.collectVisibleMatrix(grid);
    if (grid.streamExport?.canRun(format) && isTauri()) {
      // Pick the destination first, then stream the result straight into it.
      const path = await save({
        title: format === "xlsx" ? "Export Excel" : "Export CSV",
        defaultPath: `query-result-${formatTimestamp(new Date())}.${format}`,
        filters: [{ name: format === "xlsx" ? "Excel" : "CSV", extensions: [format] }],
      });
      if (!path) return false;
      onProgress?.(0);
      try {
        const result = await grid.streamExport.run({
          format,
          path,
          columns: visible.columns,
          signal,
          onProgress,
        });
        return !result.cancelled;
      } finally {
        onProgress?.(null);
      }
    }
    // Excel files are only produced by the server-side stream.
    if (format === "xlsx") return false;

    // The whole result is in the grid (not paged): export it as shown.
    const { columns, rows } = visible;
    // File interchange uses empty fields for SQL NULL, independent of the grid display token.
    const csv = toCsv(columns, rows);
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
    const from = selection.all ? 0 : Math.min(selection.startRowIndex, selection.endRowIndex);
    const to = selection.all
      ? grid.api.getDisplayedRowCount() - 1
      : Math.max(selection.startRowIndex, selection.endRowIndex);

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

type GridCommandTarget = {
  groupId: EditorGroupId;
  ownerId: string;
  eligible: boolean;
};

/** Routes workbench commands; mounting or updating a controller never activates it. */
export class QueryResultGridCommandRouter {
  private readonly targets = new Map<QueryResultGridController, GridCommandTarget>();
  private readonly listeners = new Set<SnapshotListener>();

  constructor() {
    EditorGroupsService.onDidChangeAnyGroup(() => this.fire());
  }

  register(controller: QueryResultGridController, target: GridCommandTarget): () => void {
    this.targets.set(controller, target);
    const unsubscribe = controller.onDidChangeSnapshot(() => {
      if (this.matchesActiveEditor(target)) this.fire();
    });
    this.fire();
    return () => {
      unsubscribe();
      if (this.targets.get(controller) === target) this.targets.delete(controller);
      this.fire();
    };
  }

  private target(): QueryResultGridController | undefined {
    for (const [controller, target] of this.targets) {
      if (this.matchesActiveEditor(target) && controller.isAttached()) return controller;
    }
    return undefined;
  }

  private matchesActiveEditor(target: GridCommandTarget): boolean {
    const groupId = EditorGroupsService.getFocusedGroupId();
    return target.eligible && target.groupId === groupId &&
      target.ownerId === EditorGroupsService.getGroupIfExists(groupId)?.getActiveTabId();
  }

  isAttached(): boolean { return this.target() !== undefined; }
  onDidChangeSnapshot(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  openValueEditor(): void { this.target()?.openValueEditor(); }
  async copy(mode: QueryResultCopyMode): Promise<boolean> { return this.target()?.copy(mode) ?? false; }
  async exportCsv(
    onProgress?: (rowCount: number | null) => void,
    signal?: AbortSignal,
  ): Promise<boolean> {
    return this.target()?.exportCsv(onProgress, signal) ?? false;
  }
  async exportXlsx(
    onProgress?: (rowCount: number | null) => void,
    signal?: AbortSignal,
  ): Promise<boolean> {
    return this.target()?.exportXlsx(onProgress, signal) ?? false;
  }
  clearFiltersAndSort(): void { this.target()?.clearFiltersAndSort(); }
  saveColumnLayoutNow(): boolean { return this.target()?.saveColumnLayoutNow() ?? false; }
  resetColumnLayout(): boolean { return this.target()?.resetColumnLayout() ?? false; }

  private fire(): void { this.listeners.forEach((listener) => listener()); }
}

export const QueryResultGridService = new QueryResultGridCommandRouter();
