import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type GridApi,
  type GridReadyEvent,
  type ValueFormatterParams,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { useConfiguration } from "@silk-studio/workbench/platform/configuration/useConfiguration.ts";
import type { ColorThemeId } from "@silk-studio/workbench/platform/configuration/configurationDefaults.ts";
import {
  toQueryResultRows,
  isResultTruncated,
  type QueryResultPayload,
  type QueryResultRow,
} from "../../../services/query/queryResult";
import { QueryResultGridService, DEFAULT_COLUMN_WIDTH } from "../../../services/query/queryResultGridService";
import "./QueryResultGrid.css";

ModuleRegistry.registerModules([AllCommunityModule]);

const GRID_THEME_PALETTES: Record<
  ColorThemeId,
  {
    backgroundColor: string;
    headerBackgroundColor: string;
    oddRowBackgroundColor: string;
    rowHoverColor: string;
    borderColor: string;
    inputBackgroundColor: string;
  }
> = {
  "dark-2026": {
    backgroundColor: "#191a1b",
    headerBackgroundColor: "#202122",
    oddRowBackgroundColor: "#1e1f20",
    rowHoverColor: "#242526",
    borderColor: "#2a2b2c",
    inputBackgroundColor: "#121314",
  },
  "dark-plus": {
    backgroundColor: "#1e1e1e",
    headerBackgroundColor: "#252526",
    oddRowBackgroundColor: "#2a2d2e",
    rowHoverColor: "#2a2d2e",
    borderColor: "#3c3c3c",
    inputBackgroundColor: "#3c3c3c",
  },
};

type QueryResultGridProps = {
  result: QueryResultPayload;
};

function QueryResultGrid({ result }: QueryResultGridProps) {
  const configuration = useConfiguration();
  const nullDisplay = configuration["queryResult.nullDisplay"];
  const filterEnabled = configuration["queryResult.filterEnabled"];
  const rowHeight = configuration["queryResult.rowHeight"];
  const fontSize = configuration["queryResult.fontSize"];
  const colorTheme = configuration["workbench.colorTheme"];
  const maxRows = configuration["queryResult.maxRows"];
  const truncated = isResultTruncated(result, maxRows);
  const apiRef = useRef<GridApi<QueryResultRow> | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const actionTimerRef = useRef<number | null>(null);

  const snapshot = useSyncExternalStore(
    (onStoreChange) => QueryResultGridService.onDidChangeSnapshot(onStoreChange),
    () => QueryResultGridService.getSnapshot(),
    () => QueryResultGridService.getSnapshot(),
  );

  const gridTheme = useMemo(() => {
    const palette = GRID_THEME_PALETTES[colorTheme];
    return themeQuartz.withParams({
      backgroundColor: palette.backgroundColor,
      dataBackgroundColor: palette.backgroundColor,
      foregroundColor: "#bfbfbf",
      borderColor: palette.borderColor,
      headerBackgroundColor: palette.headerBackgroundColor,
      headerTextColor: "#bfbfbf",
      headerFontWeight: 600,
      headerRowBorder: false,
      headerColumnBorder: false,
      oddRowBackgroundColor: palette.oddRowBackgroundColor,
      rowBorder: false,
      rowHoverColor: palette.rowHoverColor,
      selectedRowBackgroundColor: "rgba(57, 148, 188, 0.22)",
      inputBackgroundColor: palette.inputBackgroundColor,
      inputTextColor: "#bfbfbf",
      inputBorder: { color: "#333536" },
      fontFamily: "inherit",
      fontSize,
      headerFontSize: fontSize,
      cellHorizontalPadding: 8,
      rowHeight,
      headerHeight: rowHeight + 2,
    });
  }, [colorTheme, fontSize, rowHeight]);

  const formatCellValue = useMemo(
    () =>
      (params: ValueFormatterParams<QueryResultRow>): string => {
        if (params.value === null || params.value === undefined) {
          return nullDisplay;
        }
        return String(params.value);
      },
    [nullDisplay],
  );

  const columnDefs = useMemo<ColDef<QueryResultRow>[]>(
    () =>
      result.columns.map((column) => ({
        colId: column,
        field: column,
        headerName: column,
        filter: filterEnabled ? "agTextColumnFilter" : false,
        floatingFilter: filterEnabled,
        editable: true,
        sortable: true,
        resizable: true,
        unSortIcon: true,
        width: DEFAULT_COLUMN_WIDTH,
        minWidth: 80,
        valueFormatter: formatCellValue,
      })),
    [filterEnabled, formatCellValue, result.columns],
  );

  const rowData = useMemo(
    () => toQueryResultRows(result.columns, result.rows),
    [result.columns, result.rows],
  );

  const defaultColDef = useMemo<ColDef>(
    () => ({
      filter: filterEnabled ? "agTextColumnFilter" : false,
      floatingFilter: filterEnabled,
      editable: true,
      sortable: true,
      resizable: true,
      unSortIcon: true,
      sortingOrder: ["asc", "desc", null],
    }),
    [filterEnabled],
  );

  useEffect(() => {
    return () => {
      if (apiRef.current) {
        QueryResultGridService.detach(apiRef.current);
      }
      if (actionTimerRef.current != null) {
        window.clearTimeout(actionTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    QueryResultGridService.attach(api, result.columns, nullDisplay);
  }, [nullDisplay, result.columns]);

  const flashMessage = (message: string) => {
    setActionMessage(message);
    if (actionTimerRef.current != null) {
      window.clearTimeout(actionTimerRef.current);
    }
    actionTimerRef.current = window.setTimeout(() => {
      setActionMessage(null);
      actionTimerRef.current = null;
    }, 1800);
  };

  const handleGridReady = (event: GridReadyEvent<QueryResultRow>) => {
    apiRef.current = event.api;
    QueryResultGridService.attach(event.api, result.columns, nullDisplay);
  };

  const handleCopySelection = async () => {
    try {
      const ok = await QueryResultGridService.copy("selection");
      flashMessage(ok ? "Copied selection" : "Nothing to copy");
    } catch (error) {
      console.warn("[query-result] copy selection failed", error);
      flashMessage("Copy failed");
    }
  };

  const handleCopyRows = async () => {
    try {
      const ok = await QueryResultGridService.copy("rows");
      flashMessage(ok ? "Copied rows" : "Select a row first");
    } catch (error) {
      console.warn("[query-result] copy rows failed", error);
      flashMessage("Copy failed");
    }
  };

  const handleCopyAll = async () => {
    try {
      const ok = await QueryResultGridService.copy("all");
      flashMessage(ok ? "Copied filtered rows" : "Nothing to copy");
    } catch (error) {
      console.warn("[query-result] copy all failed", error);
      flashMessage("Copy failed");
    }
  };

  const handleExportCsv = async () => {
    try {
      const ok = await QueryResultGridService.exportCsv();
      flashMessage(ok ? "CSV exported (filtered)" : "Export cancelled");
    } catch (error) {
      console.warn("[query-result] csv export failed", error);
      flashMessage("Export failed");
    }
  };

  const handleClearFilters = () => {
    QueryResultGridService.clearFiltersAndSort();
    flashMessage("Filters and sort cleared");
  };

  const handleResetColumnLayout = () => {
    const ok = QueryResultGridService.resetColumnLayout();
    flashMessage(ok ? "Column layout reset" : "Nothing to reset");
  };

  const persistLayout = () => {
    QueryResultGridService.scheduleColumnLayoutSave();
  };

  return (
    <div className="query-result-grid">
      <div className="query-result-grid__toolbar">
        <div
          className="query-result-grid__status"
          title={statusTitle(snapshot, truncated, maxRows)}
        >
          <span>{formatRowStatus(snapshot)}</span>
          {truncated ? (
            <span
              className="query-result-grid__badge query-result-grid__badge--warn"
              title={`Result limited to ${maxRows.toLocaleString()} rows (Settings → Query Result → Max Rows). More rows may exist.`}
            >
              Truncated at {maxRows.toLocaleString()}
            </span>
          ) : null}
          {snapshot.filterActive ? (
            <span className="query-result-grid__badge">Filtered</span>
          ) : null}
          {snapshot.sortActive ? (
            <span className="query-result-grid__badge">Sorted</span>
          ) : null}
          {snapshot.hasCustomLayout ? (
            <span className="query-result-grid__badge">Layout saved</span>
          ) : null}
          {actionMessage ? (
            <span className="query-result-grid__action-msg">{actionMessage}</span>
          ) : null}
        </div>
        <div className="query-result-grid__actions">
          <button
            type="button"
            className="query-result-grid__action"
            title="Copy selection (cells, or rows)"
            aria-label="Copy selection"
            onClick={() => void handleCopySelection()}
          >
            <Codicon name="copy" />
          </button>
          <button
            type="button"
            className="query-result-grid__action"
            title="Copy selected rows"
            aria-label="Copy selected rows"
            onClick={() => void handleCopyRows()}
          >
            <Codicon name="list-selection" />
          </button>
          <button
            type="button"
            className="query-result-grid__action"
            title="Copy all filtered rows (TSV)"
            aria-label="Copy all filtered rows"
            onClick={() => void handleCopyAll()}
          >
            <Codicon name="clippy" />
          </button>
          <button
            type="button"
            className="query-result-grid__action"
            title="Export CSV (filtered rows)"
            aria-label="Export CSV"
            onClick={() => void handleExportCsv()}
          >
            <Codicon name="export" />
          </button>
          <button
            type="button"
            className="query-result-grid__action"
            title="Clear filters and sort"
            aria-label="Clear filters and sort"
            disabled={!snapshot.filterActive && !snapshot.sortActive}
            onClick={handleClearFilters}
          >
            <Codicon name="clear-all" />
          </button>
          <button
            type="button"
            className="query-result-grid__action"
            title="Reset column layout (width, order, visibility)"
            aria-label="Reset column layout"
            disabled={!snapshot.hasCustomLayout}
            onClick={handleResetColumnLayout}
          >
            <Codicon name="layout" />
          </button>
        </div>
      </div>
      <div className="query-result-grid__body">
        <AgGridReact<QueryResultRow>
          theme={gridTheme}
          columnDefs={columnDefs}
          rowData={rowData}
          defaultColDef={defaultColDef}
          rowHeight={rowHeight}
          animateRows={false}
          // Keep row/column virtualization on (defaults); light buffer for large sets.
          rowBuffer={8}
          suppressColumnVirtualisation={false}
          stopEditingWhenCellsLoseFocus
          cellSelection
          rowSelection={{
            mode: "multiRow",
            checkboxes: false,
            headerCheckbox: false,
            enableClickSelection: true,
          }}
          onGridReady={handleGridReady}
          onFilterChanged={() => QueryResultGridService.refreshSnapshot()}
          onSortChanged={() => QueryResultGridService.refreshSnapshot()}
          onModelUpdated={() => QueryResultGridService.refreshSnapshot()}
          onSelectionChanged={() => QueryResultGridService.refreshSnapshot()}
          onColumnResized={(event) => {
            if (event.finished) persistLayout();
          }}
          onColumnMoved={(event) => {
            if (event.finished) persistLayout();
          }}
          onColumnVisible={persistLayout}
          onColumnPinned={persistLayout}
        />
      </div>
    </div>
  );
}

function formatRowStatus(snapshot: {
  totalRows: number;
  displayedRows: number;
  filterActive: boolean;
}): string {
  if (snapshot.filterActive && snapshot.displayedRows !== snapshot.totalRows) {
    return `${snapshot.displayedRows.toLocaleString()} of ${snapshot.totalRows.toLocaleString()} rows`;
  }
  return `${snapshot.displayedRows.toLocaleString()} row${snapshot.displayedRows === 1 ? "" : "s"}`;
}

function statusTitle(
  snapshot: {
    totalRows: number;
    displayedRows: number;
    filterActive: boolean;
    sortActive: boolean;
    hasCustomLayout: boolean;
  },
  truncated: boolean,
  maxRows: number,
): string {
  const parts = [
    `${snapshot.displayedRows} displayed`,
    `${snapshot.totalRows} total`,
  ];
  if (truncated) {
    parts.push(`truncated at maxRows=${maxRows}`);
  }
  if (snapshot.filterActive) parts.push("filter active");
  if (snapshot.sortActive) parts.push("sort active");
  if (snapshot.hasCustomLayout) parts.push("column layout saved");
  parts.push("Copy/CSV use the filtered & sorted view");
  return parts.join(" · ");
}

export default QueryResultGrid;
