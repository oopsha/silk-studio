import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type CellValueChangedEvent,
  type ColDef,
  type ColumnState,
  type FirstDataRenderedEvent,
  type GridApi,
  type GridReadyEvent,
  type ValueFormatterParams,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { useConfiguration } from "@silk-studio/workbench/platform/configuration/useConfiguration.ts";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import type { ColorThemeId } from "@silk-studio/workbench/platform/configuration/configurationDefaults.ts";
import {
  toQueryResultRows,
  isResultTruncated,
  getQueryResultRowIndex,
  QUERY_RESULT_ROW_NUMBER_COL_ID,
  type QueryResultPayload,
  type QueryResultRow,
} from "../../../services/query/queryResult";
import { QueryResultGridService } from "../../../services/query/queryResultGridService";
import { QueryResultDirtyService } from "../../../services/query/queryResultDirtyService";
import {
  buildUpdatePreview,
  executeConfirmedUpdates,
  getSaveBlockedReason,
  resolveUpdateEligibility,
  type QueryRelationKind,
  type UpdatePreview,
} from "../../../services/query/queryResultUpdateService";
import QueryResultUpdateDialog from "./QueryResultUpdateDialog";
import "./QueryResultGrid.css";
import "./QueryResultUpdateDialog.css";

ModuleRegistry.registerModules([AllCommunityModule]);

type GridUiState = {
  filterModel: Record<string, unknown>;
  sortState: ColumnState[];
};

/**
 * Filter/sort survive a remount of the *same* result tab (e.g. the Object
 * Editor's Data tab unmounting when the user switches to another editor tab
 * and back) — ag-grid itself only keeps this in the DOM-mounted instance.
 */
const gridUiStateByTabId = new Map<string, GridUiState>();

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
  relationKind?: QueryRelationKind;
  connectionId?: string;
};

function QueryResultGrid({
  tabId,
  sql,
  result,
  relationKind,
  connectionId,
}: QueryResultGridProps) {
  const { t } = useI18n();
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
    void resolveUpdateEligibility(sql, result.columns, {
      relationKind,
      connectionId,
    }).then(
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
  }, [sql, result.columns, relationKind, connectionId]);

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
    () => [
      {
        colId: QUERY_RESULT_ROW_NUMBER_COL_ID,
        headerName: "#",
        valueGetter: (params) => (params.node?.rowIndex ?? 0) + 1,
        width: 32,
        minWidth: 32,
        pinned: "left",
        lockPosition: "left",
        suppressMovable: true,
        editable: false,
        sortable: false,
        filter: false,
        floatingFilter: false,
        resizable: false,
        suppressHeaderMenuButton: true,
        suppressAutoSize: true,
      },
      ...result.columns.map((column) => ({
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
        minWidth: 80,
        maxWidth: 480,
        valueFormatter: formatCellValue,
      })),
    ],
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
    // New result while the grid is already mounted — size after paint.
    const frame = window.requestAnimationFrame(() => {
      QueryResultGridService.autoSizeToContent();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [nullDisplay, result.columns, result.rows]);

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

    const savedUiState = gridUiStateByTabId.get(tabId);
    if (savedUiState) {
      event.api.setFilterModel(savedUiState.filterModel);
      event.api.applyColumnState({
        state: savedUiState.sortState,
        defaultState: { sort: null },
      });
    }
  };

  // Captured live (rather than on unmount) — by the time this component's
  // own unmount cleanup runs, AG Grid has already torn down the underlying
  // grid (child effects clean up before the parent's), so reading the api
  // there returns nothing useful.
  const captureGridUiState = () => {
    const api = apiRef.current;
    if (!api) return;
    gridUiStateByTabId.set(tabId, {
      filterModel: api.getFilterModel(),
      sortState: (api.getColumnState() ?? []).filter(
        (column) => column.sort != null,
      ),
    });
  };

  const handleFirstDataRendered = (
    _event: FirstDataRenderedEvent<QueryResultRow>,
  ) => {
    QueryResultGridService.autoSizeToContent();
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
      flashMessage(ok ? t("app.query.copiedSelection") : t("app.query.nothingToCopy"));
    } catch (error) {
      console.warn("[query-result] copy selection failed", error);
      flashMessage(t("app.query.copyFailed"));
    }
  };

  const handleCopyRows = async () => {
    try {
      const ok = await QueryResultGridService.copy("rows");
      flashMessage(ok ? t("app.query.copiedRows") : t("app.query.selectRowFirst"));
    } catch (error) {
      console.warn("[query-result] copy rows failed", error);
      flashMessage(t("app.query.copyFailed"));
    }
  };

  const handleCopyAll = async () => {
    try {
      const ok = await QueryResultGridService.copy("all");
      flashMessage(ok ? t("app.query.copiedFiltered") : t("app.query.nothingToCopy"));
    } catch (error) {
      console.warn("[query-result] copy all failed", error);
      flashMessage(t("app.query.copyFailed"));
    }
  };

  const handleExportCsv = async () => {
    try {
      const ok = await QueryResultGridService.exportCsv();
      flashMessage(ok ? t("app.query.csvExported") : t("app.query.exportCancelled"));
    } catch (error) {
      console.warn("[query-result] csv export failed", error);
      flashMessage(t("app.query.exportFailed"));
    }
  };

  const handleClearFilters = () => {
    QueryResultGridService.clearFiltersAndSort();
    flashMessage(t("app.query.filtersCleared"));
  };

  const handleResetColumnLayout = () => {
    const ok = QueryResultGridService.resetColumnLayout();
    flashMessage(ok ? t("app.query.layoutReset") : t("app.query.nothingToReset"));
  };

  const handleSaveColumnLayout = () => {
    const ok = QueryResultGridService.saveColumnLayoutNow();
    flashMessage(ok ? t("app.query.layoutSaved") : t("app.query.nothingToSaveLayout"));
  };

  const markLayoutDirty = () => {
    QueryResultGridService.markColumnLayoutDirty();
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
        connectionId,
      });
      if ("blocked" in nextPreview) {
        flashMessage(nextPreview.reason);
        return;
      }
      setPreview(nextPreview);
    } catch (error) {
      console.warn("[query-result] update preview failed", error);
      flashMessage(t("app.query.updatePreviewFailed"));
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
    const outcome = await executeConfirmedUpdates(tabId, preview.statements, {
      connectionId,
    });
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
          title={statusTitle(
            snapshot,
            truncated,
            maxRows,
            saveBlockedReason,
            t,
          )}
        >
          <span>{formatRowStatus(snapshot, t)}</span>
          {dirtyCount > 0 ? (
            <span
              className="query-result-grid__badge query-result-grid__badge--dirty"
              title={t("app.query.dirtyCellsTitle").replace(
                "{n}",
                String(dirtyCount),
              )}
            >
              {t("app.query.badgeUnsaved").replace("{n}", String(dirtyCount))}
            </span>
          ) : null}
          {truncated ? (
            <span
              className="query-result-grid__badge query-result-grid__badge--warn"
              title={t("app.query.truncatedTitle").replace(
                "{n}",
                maxRows.toLocaleString(),
              )}
            >
              {t("app.query.badgeTruncated").replace(
                "{n}",
                maxRows.toLocaleString(),
              )}
            </span>
          ) : null}
          {snapshot.filterActive ? (
            <span className="query-result-grid__badge">
              {t("app.query.badgeFiltered")}
            </span>
          ) : null}
          {snapshot.sortActive ? (
            <span className="query-result-grid__badge">
              {t("app.query.badgeSorted")}
            </span>
          ) : null}
          {snapshot.layoutDirty ? (
            <span className="query-result-grid__badge">
              {t("app.query.badgeLayoutDirty")}
            </span>
          ) : snapshot.hasCustomLayout ? (
            <span className="query-result-grid__badge">
              {t("app.query.badgeLayout")}
            </span>
          ) : null}
          {saveBlockedReason ? (
            <span
              className="query-result-grid__badge query-result-grid__badge--blocked"
              title={saveBlockedReason}
            >
              {t("app.query.badgeSaveBlocked")}
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
              t("app.query.saveChangesTitle")
            }
            aria-label={t("app.query.saveChanges")}
            disabled={!canAttemptSave || openingPreview}
            onClick={() => void handleOpenSavePreview()}
          >
            <Codicon name="save" />
          </button>
          <button
            type="button"
            className="query-result-grid__action"
            title={t("app.query.copySelectionTitle")}
            aria-label={t("app.query.copySelection")}
            onClick={() => void handleCopySelection()}
          >
            <Codicon name="copy" />
          </button>
          <button
            type="button"
            className="query-result-grid__action"
            title={t("app.query.copyRowsTitle")}
            aria-label={t("app.query.copySelectedRows")}
            onClick={() => void handleCopyRows()}
          >
            <Codicon name="list-selection" />
          </button>
          <button
            type="button"
            className="query-result-grid__action"
            title={t("app.query.copyFilteredTitle")}
            aria-label={t("app.query.copyAllFiltered")}
            onClick={() => void handleCopyAll()}
          >
            <Codicon name="clippy" />
          </button>
          <button
            type="button"
            className="query-result-grid__action"
            title={t("app.query.exportCsvTitle")}
            aria-label={t("app.query.exportCsv")}
            onClick={() => void handleExportCsv()}
          >
            <Codicon name="export" />
          </button>
          <button
            type="button"
            className="query-result-grid__action"
            title={t("app.query.clearFiltersTitle")}
            aria-label={t("app.query.clearFiltersTitle")}
            disabled={!snapshot.filterActive && !snapshot.sortActive}
            onClick={handleClearFilters}
          >
            <Codicon name="clear-all" />
          </button>
          <button
            type="button"
            className="query-result-grid__action"
            title={t("app.query.saveLayoutTitle")}
            aria-label={t("app.query.saveLayout")}
            disabled={!snapshot.layoutDirty}
            onClick={handleSaveColumnLayout}
          >
            <Codicon name="bookmark" />
          </button>
          <button
            type="button"
            className="query-result-grid__action"
            title={t("app.query.resetLayoutTitle")}
            aria-label={t("app.query.resetLayout")}
            disabled={!snapshot.hasCustomLayout && !snapshot.layoutDirty}
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
          // SQL result column labels are always literal strings (e.g. an unaliased
          // `PKG.FUNC('a')` call), never a dotted nested-object path — without this,
          // AG Grid treats any "." in a field name as a nested-path accessor and
          // silently renders such columns as blank/NULL.
          suppressFieldDotNotation
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
          onFirstDataRendered={handleFirstDataRendered}
          onCellValueChanged={handleCellValueChanged}
          onFilterChanged={() => {
            QueryResultGridService.refreshSnapshot();
            captureGridUiState();
          }}
          onSortChanged={() => {
            QueryResultGridService.refreshSnapshot();
            captureGridUiState();
          }}
          onModelUpdated={() => QueryResultGridService.refreshSnapshot()}
          onSelectionChanged={() => QueryResultGridService.refreshSnapshot()}
          onColumnResized={(event) => {
            if (event.finished) markLayoutDirty();
          }}
          onColumnMoved={(event) => {
            if (event.finished) markLayoutDirty();
          }}
          onColumnVisible={markLayoutDirty}
          onColumnPinned={markLayoutDirty}
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

function formatRowStatus(
  snapshot: {
    totalRows: number;
    displayedRows: number;
    filterActive: boolean;
  },
  t: (key:
    | "app.query.rowsOf"
    | "app.query.rowsCount"
    | "app.query.rowCountOne") => string,
): string {
  if (snapshot.filterActive && snapshot.displayedRows !== snapshot.totalRows) {
    return t("app.query.rowsOf")
      .replace("{shown}", snapshot.displayedRows.toLocaleString())
      .replace("{total}", snapshot.totalRows.toLocaleString());
  }
  if (snapshot.displayedRows === 1) {
    return t("app.query.rowCountOne");
  }
  return t("app.query.rowsCount").replace(
    "{n}",
    snapshot.displayedRows.toLocaleString(),
  );
}

function statusTitle(
  snapshot: {
    totalRows: number;
    displayedRows: number;
    filterActive: boolean;
    sortActive: boolean;
    hasCustomLayout: boolean;
    layoutDirty: boolean;
  },
  truncated: boolean,
  maxRows: number,
  saveBlockedReason: string | null,
  t: (key:
    | "app.query.statusDisplayed"
    | "app.query.statusTotal"
    | "app.query.statusTruncated"
    | "app.query.statusFilterActive"
    | "app.query.statusSortActive"
    | "app.query.statusLayoutSaved"
    | "app.query.statusLayoutDirty"
    | "app.query.statusHintFilter"
    | "app.query.statusHintEdit") => string,
): string {
  const parts = [
    t("app.query.statusDisplayed").replace("{n}", String(snapshot.displayedRows)),
    t("app.query.statusTotal").replace("{n}", String(snapshot.totalRows)),
  ];
  if (truncated) {
    parts.push(
      t("app.query.statusTruncated").replace("{n}", String(maxRows)),
    );
  }
  if (saveBlockedReason) {
    parts.push(saveBlockedReason);
  }
  if (snapshot.filterActive) parts.push(t("app.query.statusFilterActive"));
  if (snapshot.sortActive) parts.push(t("app.query.statusSortActive"));
  if (snapshot.layoutDirty) {
    parts.push(t("app.query.statusLayoutDirty"));
  } else if (snapshot.hasCustomLayout) {
    parts.push(t("app.query.statusLayoutSaved"));
  }
  parts.push(t("app.query.statusHintFilter"));
  parts.push(t("app.query.statusHintEdit"));
  return parts.join(" · ");
}

export default QueryResultGrid;
