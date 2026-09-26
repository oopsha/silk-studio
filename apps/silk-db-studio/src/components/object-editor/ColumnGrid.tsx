import { useEffect, useMemo, useRef, useState } from "react";
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef, type GridApi, type GridOptions, type CellMouseDownEvent, type CellMouseOverEvent, type CellDoubleClickedEvent, type NavigateToNextCellParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { isTauri } from "@tauri-apps/api/core";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { useConfiguration } from "@silk-studio/workbench/platform/configuration/useConfiguration.ts";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import { AppNotificationService } from "@silk-studio/workbench/services/notifications/appNotificationService.ts";
import { resolveEffectiveColorTheme } from "@silk-studio/ui/platform/colorTheme.ts";
import { toCsv, toTsv } from "../../services/query/queryResultFormat";
import "./ColumnGrid.css";

ModuleRegistry.registerModules([AllCommunityModule]);

export type ColumnGridRow = { rowId: string; [key: string]: unknown };
export type ColumnGridColumn<Row extends ColumnGridRow> = {
  field: string;
  title: string;
  width?: number;
  value: (row: Row) => string;
  render?: ColDef<Row>["cellRenderer"];
  edit?: {
    enabled: (row: Row) => boolean;
    value: (row: Row) => unknown;
    apply: (row: Row, value: unknown) => void;
    editor?: ColDef<Row>["cellEditor"];
    editorParams?: ColDef<Row>["cellEditorParams"];
  };
};

type Selection = { anchorRow: number; focusRow: number; anchorColumn: number; focusColumn: number };

type Props<Row extends ColumnGridRow> = {
  rows: Row[];
  columns: ColumnGridColumn<Row>[];
  filename: string;
  actions?: React.ReactNode;
  onFocusedRow?: (row: Row) => void;
  rowClassRules?: GridOptions<Row>["rowClassRules"];
};

export default function ColumnGrid<Row extends ColumnGridRow>({ rows, columns, filename, actions, onFocusedRow, rowClassRules }: Props<Row>) {
  const { t } = useI18n();
  const configuration = useConfiguration();
  const apiRef = useRef<GridApi<Row> | null>(null);
  const columnsRef = useRef(columns);
  columnsRef.current = columns;
  const selectionRef = useRef<Selection | null>(null);
  const draggingRef = useRef(false);
  const applyingLayoutRef = useRef(false);
  const [filterActive, setFilterActive] = useState(false);
  const [sortActive, setSortActive] = useState(false);
  const [layoutDirty, setLayoutDirty] = useState(false);
  const [hasLayout, setHasLayout] = useState(false);
  const layoutKey = `silk.columnGrid.layout.${filename}.${columns.map((column) => column.field).join(".")}`;

  useEffect(() => {
    const stop = () => { draggingRef.current = false; };
    window.addEventListener("mouseup", stop);
    return () => window.removeEventListener("mouseup", stop);
  }, []);

  const colorTheme = configuration["workbench.colorTheme"];
  const palette = resolveEffectiveColorTheme(colorTheme) === "light"
    ? { background: "#fafafd", foreground: "#202020", header: "#eaeaea", odd: "#f5f5f7", hover: "rgba(0,0,0,.06)", border: "#f0f1f2", input: "#fff", inputBorder: "#d8d8d8", selected: "rgba(0,105,204,.15)" }
    : { background: "#191a1b", foreground: "#bfbfbf", header: "#202122", odd: "#1e1f20", hover: "#242526", border: "#2a2b2c", input: "#121314", inputBorder: "#333536", selected: "rgba(57,148,188,.22)" };
  const rowHeight = configuration["queryResult.rowHeight"];
  const fontSize = configuration["queryResult.fontSize"];
  const theme = useMemo(() => themeQuartz.withParams({
    backgroundColor: palette.background, dataBackgroundColor: palette.background,
    foregroundColor: palette.foreground, borderColor: palette.border,
    headerBackgroundColor: palette.header, headerTextColor: palette.foreground,
    headerFontWeight: 600, headerRowBorder: false, headerColumnBorder: false,
    oddRowBackgroundColor: palette.odd, rowBorder: false, rowHoverColor: palette.hover,
    selectedRowBackgroundColor: palette.selected, inputBackgroundColor: palette.input,
    inputTextColor: palette.foreground, inputBorder: { color: palette.inputBorder },
    fontFamily: "inherit", fontSize, headerFontSize: fontSize, cellHorizontalPadding: 8,
    rowHeight, headerHeight: rowHeight + 2,
  }), [colorTheme, rowHeight, fontSize]);

  const fields = useMemo(() => columns.filter((column) => column.field !== "action").map((column) => column.field), [columns]);
  const visibleColumns = () => apiRef.current?.getAllDisplayedColumns()
    .filter((column) => fields.includes(column.getColId()))
    .map((column) => column.getColId()) ?? fields;
  const displayRows = () => {
    const result: Row[] = [];
    apiRef.current?.forEachNodeAfterFilterAndSort((node) => { if (node.data) result.push(node.data); });
    return result;
  };
  const label = (field: string) => columns.find((column) => column.field === field)?.title ?? field;
  const value = (row: Row, field: string) => columns.find((column) => column.field === field)?.value(row) ?? "";
  const matrix = (selectedFields: string[], selectedRows: Row[]) => ({
    headers: selectedFields.map(label),
    cells: selectedRows.map((row) => selectedFields.map((field) => value(row, field))),
  });
  const copy = async (mode: "selection" | "rows" | "all") => {
    const api = apiRef.current;
    if (!api) return;
    const all = displayRows();
    const fields = visibleColumns();
    if (mode === "all") {
      const data = matrix(fields, all);
      await navigator.clipboard.writeText(toTsv(data.headers, data.cells, ""));
      return;
    }
    if (mode === "rows") {
      const selected = all.filter((row) => api.getRowNode(row.rowId)?.isSelected());
      const focused = api.getFocusedCell();
      const fallback = focused ? api.getDisplayedRowAtIndex(focused.rowIndex)?.data : null;
      const data = matrix(fields, selected.length ? selected : fallback ? [fallback] : []);
      if (data.cells.length) await navigator.clipboard.writeText(toTsv(data.headers, data.cells, ""));
      return;
    }
    const selection = selectionRef.current;
    if (selection) {
      const selectedFields = fields.slice(Math.min(selection.anchorColumn, selection.focusColumn), Math.max(selection.anchorColumn, selection.focusColumn) + 1);
      const selectedRows = all.slice(Math.min(selection.anchorRow, selection.focusRow), Math.max(selection.anchorRow, selection.focusRow) + 1);
      const data = matrix(selectedFields, selectedRows);
      if (data.cells.length) await navigator.clipboard.writeText(toTsv(data.headers, data.cells, "", { includeHeader: false }));
    }
  };
  const exportCsv = async () => {
    const data = matrix(visibleColumns(), displayRows());
    const csv = toCsv(data.headers, data.cells, "");
    const name = `${filename}.csv`;
    if (isTauri()) {
      const path = await save({ title: "Export CSV", defaultPath: name, filters: [{ name: "CSV", extensions: ["csv"] }] });
      if (!path) return;
      await writeTextFile(path, csv);
    } else {
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      URL.revokeObjectURL(url);
    }
  };
  const runAction = (action: Promise<void>, failureMessage: string) => {
    void action.catch((error) => {
      console.warn("[column-grid] action failed", error);
      AppNotificationService.show(failureMessage, "error");
    });
  };
  const updateSelection = (anchorRow: number, anchorColumn: number, focusRow: number, focusColumn: number) => {
    selectionRef.current = { anchorRow, anchorColumn, focusRow, focusColumn };
    apiRef.current?.refreshCells();
  };
  const onMouseDown = (event: CellMouseDownEvent<Row>) => {
    const mouse = event.event;
    if (!(mouse instanceof MouseEvent) || mouse.button !== 0 || event.rowIndex == null) return;
    if (event.data) onFocusedRow?.(event.data);
    const index = visibleColumns().indexOf(event.column.getColId());
    if (mouse.target instanceof Element && mouse.target.closest("button")) {
      if (index >= 0) {
        if (mouse.shiftKey && selectionRef.current) updateSelection(selectionRef.current.anchorRow, selectionRef.current.anchorColumn, event.rowIndex, index);
        else selectionRef.current = { anchorRow: event.rowIndex, focusRow: event.rowIndex, anchorColumn: index, focusColumn: index };
        draggingRef.current = true;
      }
      event.node.setSelected(true, true);
      return;
    }
    if (index < 0) { event.node.setSelected(true, true); return; }
    if (mouse.shiftKey && selectionRef.current) {
      updateSelection(selectionRef.current.anchorRow, selectionRef.current.anchorColumn, event.rowIndex, index);
    } else {
      updateSelection(event.rowIndex, index, event.rowIndex, index);
    }
    if (mouse.shiftKey && selectionRef.current) {
      const from = Math.min(selectionRef.current.anchorRow, event.rowIndex);
      const to = Math.max(selectionRef.current.anchorRow, event.rowIndex);
      if (!mouse.ctrlKey && !mouse.metaKey) event.api.deselectAll();
      for (let index = from; index <= to; index += 1) event.api.getDisplayedRowAtIndex(index)?.setSelected(true, false);
    } else if (mouse.ctrlKey || mouse.metaKey) event.node.setSelected(!event.node.isSelected(), false);
    else event.node.setSelected(true, true);
    draggingRef.current = true;
  };
  const onMouseOver = (event: CellMouseOverEvent<Row>) => {
    if (!draggingRef.current || event.rowIndex == null || !selectionRef.current) return;
    const index = visibleColumns().indexOf(event.column.getColId());
    if (index >= 0) updateSelection(selectionRef.current.anchorRow, selectionRef.current.anchorColumn, event.rowIndex, index);
  };
  const columnSignature = columns.map((column) => `${column.field}:${column.title}:${column.width ?? 150}`).join("|");
  const defs = useMemo<ColDef<Row>[]>(() => [
    { colId: "__row_number", headerName: "#", valueGetter: (params) => (params.node?.rowIndex ?? 0) + 1, width: 56, minWidth: 40, pinned: "left", lockPosition: "left", suppressMovable: true, sortable: false, filter: false },
    ...columns.map((column) => ({
      colId: column.field, headerName: column.title, width: column.width ?? 150,
      sortable: column.field !== "action", filter: column.field === "action" ? false : "agTextColumnFilter",
      floatingFilter: column.field !== "action",
      editable: (params: { data?: Row }) => {
        const edit = columnsRef.current.find((item) => item.field === column.field)?.edit;
        return !!params.data && !!edit?.enabled(params.data);
      },
      cellEditor: column.edit?.editor,
      cellEditorParams: column.edit?.editorParams,
      valueGetter: (params: { data?: Row }) => {
        if (!params.data) return "";
        const current = columnsRef.current.find((item) => item.field === column.field);
        return current?.edit ? current.edit.value(params.data) : current?.value(params.data) ?? "";
      },
      valueFormatter: (params: { data?: Row; value: unknown }) => params.data
        ? columnsRef.current.find((item) => item.field === column.field)?.value(params.data) ?? ""
        : String(params.value ?? ""),
      valueSetter: (params: { data?: Row; newValue: unknown }) => {
        const edit = columnsRef.current.find((item) => item.field === column.field)?.edit;
        if (!params.data || !edit || !edit.enabled(params.data)) return false;
        edit.apply(params.data, params.newValue);
        return false;
      },
      cellRenderer: column.render ? (params: unknown) => {
        const renderer = columnsRef.current.find((item) => item.field === column.field)?.render;
        return typeof renderer === "function" ? renderer(params) : null;
      } : undefined,
      cellClassRules: {
        "column-grid__cell--selected": (params: { node: { rowIndex: number | null }; column: { getColId(): string } }) => {
          const selection = selectionRef.current;
          const row = params.node.rowIndex;
          const col = visibleColumns().indexOf(params.column.getColId());
          return !!selection && row != null && col >= 0 && row >= Math.min(selection.anchorRow, selection.focusRow) && row <= Math.max(selection.anchorRow, selection.focusRow) && col >= Math.min(selection.anchorColumn, selection.focusColumn) && col <= Math.max(selection.anchorColumn, selection.focusColumn);
        },
      },
    })),
  // The definitions stay stable while row values change, preserving focus in editable cells.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [columnSignature]);
  const saveLayout = () => {
    const state = apiRef.current?.getColumnState()
      .filter((column) => column.colId !== "__row_number")
      .map(({ colId, width, flex, hide, pinned }) => ({ colId, width, flex, hide, pinned }));
    if (!state) return;
    localStorage.setItem(layoutKey, JSON.stringify(state));
    setHasLayout(true);
    setLayoutDirty(false);
  };
  const resetLayout = () => {
    localStorage.removeItem(layoutKey);
    applyingLayoutRef.current = true;
    apiRef.current?.resetColumnState();
    window.setTimeout(() => { applyingLayoutRef.current = false; }, 150);
    setHasLayout(false);
    setLayoutDirty(false);
  };
  const updateFlags = () => {
    const api = apiRef.current;
    setFilterActive(api?.isAnyFilterPresent() ?? false);
    setSortActive(api?.getColumnState().some((column) => column.sort != null) ?? false);
  };
  return <div className="column-grid">
    <div className="column-grid__toolbar"><span className="column-grid__status">{displayRows().length || rows.length} / {rows.length}</span><div className="column-grid__actions">
      {actions}
      <button title={t("app.query.copySelectionTitle")} aria-label={t("app.query.copySelection")} onClick={() => runAction(copy("selection"), t("app.query.copyFailed"))}><Codicon name="copy" /></button>
      <button title={t("app.query.copyRowsTitle")} aria-label={t("app.query.copySelectedRows")} onClick={() => runAction(copy("rows"), t("app.query.copyFailed"))}><Codicon name="list-selection" /></button>
      <button title={t("app.query.copyFilteredTitle")} aria-label={t("app.query.copyAllFiltered")} onClick={() => runAction(copy("all"), t("app.query.copyFailed"))}><Codicon name="clippy" /></button>
      <button title={t("app.query.exportCsvTitle")} aria-label={t("app.query.exportCsv")} onClick={() => runAction(exportCsv(), t("app.query.exportFailed"))}><Codicon name="export" /></button>
      <button title={t("app.query.clearFiltersTitle")} aria-label={t("app.query.clearFiltersTitle")} disabled={!filterActive && !sortActive} onClick={() => { apiRef.current?.setFilterModel(null); apiRef.current?.applyColumnState({ defaultState: { sort: null } }); updateFlags(); }}><Codicon name="clear-all" /></button>
      <button title={t("app.query.saveLayoutTitle")} aria-label={t("app.query.saveLayout")} disabled={!layoutDirty} onClick={saveLayout}><Codicon name="bookmark" /></button>
      <button title={t("app.query.resetLayoutTitle")} aria-label={t("app.query.resetLayout")} disabled={!hasLayout && !layoutDirty} onClick={resetLayout}><Codicon name="layout" /></button>
    </div></div>
    <div className="column-grid__body" onKeyDownCapture={(event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c" && !(event.target instanceof HTMLInputElement)) { event.preventDefault(); runAction(copy("selection"), t("app.query.copyFailed")); } }}>
      <AgGridReact<Row> theme={theme} rowData={rows} columnDefs={defs} getRowId={(params) => params.data.rowId} rowClassRules={rowClassRules}
        defaultColDef={{ sortable: true, filter: "agTextColumnFilter", floatingFilter: true, filterParams: { buttons: ["apply", "reset"] }, resizable: true, suppressHeaderMenuButton: true }}
        rowSelection={{ mode: "multiRow", checkboxes: false, headerCheckbox: false, enableClickSelection: false }}
        suppressFieldDotNotation animateRows={false} rowHeight={rowHeight} suppressColumnVirtualisation suppressClickEdit stopEditingWhenCellsLoseFocus
        onGridReady={(event) => { apiRef.current = event.api; const saved = localStorage.getItem(layoutKey); if (saved) { try { applyingLayoutRef.current = true; event.api.applyColumnState({ state: JSON.parse(saved), applyOrder: true }); setHasLayout(true); window.setTimeout(() => { applyingLayoutRef.current = false; }, 150); } catch { applyingLayoutRef.current = false; localStorage.removeItem(layoutKey); } } updateFlags(); }} onCellMouseDown={onMouseDown} onCellMouseOver={onMouseOver}
        onCellDoubleClicked={(event: CellDoubleClickedEvent<Row>) => {
          if (event.rowIndex == null || !event.data) return;
          const edit = columnsRef.current.find((column) => column.field === event.column.getColId())?.edit;
          if (edit?.enabled(event.data)) event.api.startEditingCell({ rowIndex: event.rowIndex, colKey: event.column });
        }}
        navigateToNextCell={(params: NavigateToNextCellParams<Row>) => { const next = params.nextCellPosition; if (next) { const index = visibleColumns().indexOf(next.column.getColId()); if (index >= 0) updateSelection(next.rowIndex, index, next.rowIndex, index); } return next; }}
        onFilterChanged={updateFlags} onSortChanged={updateFlags}
        onColumnResized={(event) => { if (event.finished && !applyingLayoutRef.current) setLayoutDirty(true); }}
        onColumnMoved={(event) => { if (event.finished && !applyingLayoutRef.current) setLayoutDirty(true); }}
        onColumnVisible={() => { if (!applyingLayoutRef.current) setLayoutDirty(true); }}
        onColumnPinned={() => { if (!applyingLayoutRef.current) setLayoutDirty(true); }} />
    </div>
  </div>;
}
