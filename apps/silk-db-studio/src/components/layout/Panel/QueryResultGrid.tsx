import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type CellValueChangedEvent,
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
  getQueryResultRowIndex,
  type QueryResultPayload,
  type QueryResultRow,
} from "../../../services/query/queryResult";
import { QueryResultGridService, DEFAULT_COLUMN_WIDTH } from "../../../services/query/queryResultGridService";
import { QueryResultDirtyService } from "../../../services/query/queryResultDirtyService";
import {
  buildUpdatePreview,
  executeConfirmedUpdates,
  getSaveBlockedReason,
  resolveUpdateEligibility,
  type UpdatePreview,
} from "../../../services/query/queryResultUpdateService";
import QueryResultUpdateDialog from "./QueryResultUpdateDialog";
import "./QueryResultGrid.css";
import "./QueryResultUpdateDialog.css";

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
  tabId: string;
  sql: string;
  result: QueryResultPayload;
  relationKind?: "table" | "view";
};

function QueryResultGrid({ tabId, sql, result, relationKind }: QueryResultGridProps) {
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
  const [primaryKeys, setPrimaryKeys] = useState<string[] | null>(null);
  const [saveBlockedReason, setSaveBlockedReason] = useState<string | null>(null);
  const [preview, setPreview] = useState<UpdatePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [executingUpdates, setExecutingUpdates] = useState(false);
  const [openingPreview, setOpeningPreview] = useState(false);

  const dirtyCount = useSyncExternalStore(
    (onStoreChange) => QueryResultDirtyService.onDidChange(onStoreChange),
    () => QueryResultDirtyService.getDirtyCount(tabId),
    () => QueryResultDirtyService.getDirtyCount(tabId),
  );

  const snapshot = useSyncExternalStore(
    (onStoreChange) => QueryResultGridService.onDidChangeSnapshot(onStoreChange),
    () => QueryResultGridService.getSnapshot(),
    () => QueryResultGridService.getSnapshot(),
  );

  const normalizeEditedValue = useCallback(
    (value: unknown): string | null => {
      if (value === null || value === undefined) {
        return null;
      }
      const text = String(value);
      if (text === nullDisplay || text.trim() === "") {
        return null;
      }
      return text;
    },
    [nullDisplay],
  );

  useEffect(() => {
    QueryResultDirtyService.initTab(tabId, result.columns, result.rows);
    return () => {
      QueryResultDirtyService.removeTab(tabId);
    };
  }, [tabId, result.columns, result.rows]);

  useEffect(() => {
    let cancelled = false;
    void resolveUpdateEligibility(sql, result.columns, { relationKind }).then(
      (eligibility) => {
      if (cancelled) return;
      if (eligibility.eligible) {
        setPrimaryKeys(eligibility.primaryKeys);
        setSaveBlockedReason(null);
        return;
      }
      setPrimaryKeys([]);
      setSaveBlockedReason(eligibility.reason);
    },
    );
    return () => {
      cancelled = true;
    };
  }, [sql, result.columns, relationKind]);

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

  const primaryKeySet = useMemo(
    () => new Set(primaryKeys ?? []),
    [primaryKeys],
  );

  const columnDefs = useMemo<ColDef<QueryResultRow>[]>(
    () =>
      result.columns.map((column) => ({
        colId: column,
        field: column,
        headerName: column,
        filter: filterEnabled ? "agTextColumnFilter" : false,
        floatingFilter: filterEnabled,
        // Editing is always allowed; only known PK columns stay read-only.
        editable:
          primaryKeys == null || primaryKeys.length === 0
            ? true
            : !primaryKeySet.has(column),
        sortable: true,
        resizable: true,
        unSortIcon: true,
        width: DEFAULT_COLUMN_WIDTH,
        minWidth: 80,
        valueFormatter: formatCellValue,
      })),
    [filterEnabled, formatCellValue, primaryKeySet, primaryKeys, result.columns],
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
    }, 2800);
  };

  const handleGridReady = (event: GridReadyEvent<QueryResultRow>) => {
    apiRef.current = event.api;
    QueryResultGridService.attach(event.api, result.columns, nullDisplay);
  };

  const handleCellValueChanged = (event: CellValueChangedEvent<QueryResultRow>) => {
    const rowIndex = event.data ? getQueryResultRowIndex(event.data) : null;
    const field = event.colDef.field;
    if (rowIndex == null || !field || field === "__rowIndex") {
      return;
    }
    QueryResultDirtyService.setCell(
      tabId,
      rowIndex,
      field,
      normalizeEditedValue(event.newValue),
    );
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

  const saveHint =
    saveBlockedReason ??
    getSaveBlockedReason(sql, dirtyCount, { relationKind });

  const canAttemptSave = dirtyCount > 0 && !saveBlockedReason;

  const handleOpenSavePreview = async () => {
    if (!canAttemptSave) {
      if (saveHint) {
        flashMessage(saveHint);
      }
      return;
    }

    setOpeningPreview(true);
    setPreviewError(null);
    try {
      const nextPreview = await buildUpdatePreview(tabId, sql, result.columns, {
        relationKind,
      });
      if ("blocked" in nextPreview) {
        flashMessage(nextPreview.reason);
        return;
      }
      setPreview(nextPreview);
    } catch (error) {
      console.warn("[query-result] update preview failed", error);
      flashMessage("Failed to build UPDATE preview");
    } finally {
      setOpeningPreview(false);
    }
  };

  const handleClosePreview = () => {
    if (executingUpdates) return;
    setPreview(null);
    setPreviewError(null);
  };

  const handleConfirmUpdates = async () => {
    if (!preview) return;
    setExecutingUpdates(true);
    setPreviewError(null);
    const outcome = await executeConfirmedUpdates(tabId, preview.statements);
    setExecutingUpdates(false);
    if (!outcome.ok) {
      setPreviewError(outcome.message);
      return;
    }
    setPreview(null);
    flashMessage(outcome.message);
  };

  const tableLabel = preview
    ? preview.eligibility.schema
      ? `${preview.eligibility.schema}.${preview.eligibility.table}`
      : preview.eligibility.table
    : "";

  return (
    <div className="query-result-grid">
      <div className="query-result-grid__toolbar">
        <div
          className="query-result-grid__status"
          title={statusTitle(snapshot, truncated, maxRows, saveBlockedReason)}
        >
          <span>{formatRowStatus(snapshot)}</span>
          {dirtyCount > 0 ? (
            <span
              className="query-result-grid__badge query-result-grid__badge--dirty"
              title={`${dirtyCount} edited cell${dirtyCount === 1 ? "" : "s"} not saved`}
            >
              {dirtyCount} unsaved
            </span>
          ) : null}
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
          {saveBlockedReason ? (
            <span
              className="query-result-grid__badge query-result-grid__badge--blocked"
              title={saveBlockedReason}
            >
              Save blocked
            </span>
          ) : null}
          {actionMessage ? (
            <span className="query-result-grid__action-msg">{actionMessage}</span>
          ) : null}
        </div>
        <div className="query-result-grid__actions">
          <button
            type="button"
            className="query-result-grid__action query-result-grid__action--save"
            title={
              saveHint ??
              "Preview and execute UPDATE statements for edited cells"
            }
            aria-label="Save changes"
            disabled={!canAttemptSave || openingPreview}
            onClick={() => void handleOpenSavePreview()}
          >
            <Codicon name="save" />
          </button>
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
          rowBuffer={8}
          suppressColumnVirtualisation={false}
          stopEditingWhenCellsLoseFocus
          getRowId={(params) =>
            params.data ? String(getQueryResultRowIndex(params.data)) : "0"
          }
          cellSelection
          rowSelection={{
            mode: "multiRow",
            checkboxes: false,
            headerCheckbox: false,
            enableClickSelection: true,
          }}
          onGridReady={handleGridReady}
          onCellValueChanged={handleCellValueChanged}
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

      {preview ? (
        <QueryResultUpdateDialog
          tableLabel={tableLabel}
          dirtyRowCount={preview.dirtyRowCount}
          dirtyCellCount={preview.dirtyCellCount}
          statements={preview.statements}
          errorMessage={previewError}
          executing={executingUpdates}
          onCancel={handleClosePreview}
          onConfirm={() => void handleConfirmUpdates()}
        />
      ) : null}
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
  saveBlockedReason: string | null,
): string {
  const parts = [
    `${snapshot.displayedRows} displayed`,
    `${snapshot.totalRows} total`,
  ];
  if (truncated) {
    parts.push(`truncated at maxRows=${maxRows}`);
  }
  if (saveBlockedReason) {
    parts.push(saveBlockedReason);
  }
  if (snapshot.filterActive) parts.push("filter active");
  if (snapshot.sortActive) parts.push("sort active");
  if (snapshot.hasCustomLayout) parts.push("column layout saved");
  parts.push("Copy/CSV use the filtered & sorted view");
  parts.push("Edited cells require preview + confirm before UPDATE");
  return parts.join(" · ");
}

export default QueryResultGrid;
