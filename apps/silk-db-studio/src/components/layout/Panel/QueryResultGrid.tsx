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
  type IDatasource,
  type IGetRowsParams,
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
  QUERY_RESULT_ROW_INDEX_KEY,
  QUERY_RESULT_ROW_NUMBER_COL_ID,
  type QueryResultPayload,
  type QueryResultRow,
} from "../../../services/query/queryResult";
import { QueryResultGridService } from "../../../services/query/queryResultGridService";
import ContextMenu, { type ContextMenuItem } from "../../common/ContextMenu";
import { fetchQueryResultPage } from "../../../services/query/queryResultPaging";
import {
  translateFilterModel,
  translateSortModel,
} from "../../../services/query/filterModelTranslator";
import { QueryResultDirtyService } from "../../../services/query/queryResultDirtyService";
import { formatErrorMessage } from "../../../services/formatErrorMessage";
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

/**
 * Infinite Row Model page size — decoupled from `queryResult.maxRows` (which only controls when
 * a result is *considered* truncated / switches into this mode at all) so a small maxRows used to
 * detect truncation early doesn't also force tiny, chatty scroll pages.
 */
const INFINITE_SCROLL_BLOCK_SIZE = 100;

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
  dark: {
    backgroundColor: "#191a1b",
    headerBackgroundColor: "#202122",
    oddRowBackgroundColor: "#1e1f20",
    rowHoverColor: "#242526",
    borderColor: "#2a2b2c",
    inputBackgroundColor: "#121314",
  },
  // No light-mode grid palette defined yet (see colorThemes.ts) — reuses dark until
  // that work lands.
  light: {
    backgroundColor: "#191a1b",
    headerBackgroundColor: "#202122",
    oddRowBackgroundColor: "#1e1f20",
    rowHoverColor: "#242526",
    borderColor: "#2a2b2c",
    inputBackgroundColor: "#121314",
  },
};

type QueryResultGridProps = {
  tabId: string;
  sql: string;
  /** Exact statement text actually executed (bind placeholders already resolved to `?`), when it
   *  differs from `sql` — see `QueryResultTab.executedSql`. Falls back to `sql` when absent. */
  executedSql?: string;
  binds?: Array<string | null>;
  result: QueryResultPayload;
  relationKind?: QueryRelationKind;
  connectionId?: string;
};

function QueryResultGrid({
  tabId,
  sql,
  executedSql,
  binds,
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
  // A truncated result switches the grid to server-paged Infinite Row Model scrolling — but only
  // when there's a connection to page against (e.g. AI-context previews may show a result with no
  // live connectionId). Filtering/sorting are not yet wired into paged fetches (5-D v2 stages 3-4).
  const useInfiniteMode = truncated && !!connectionId?.trim();
  const apiRef = useRef<GridApi<QueryResultRow> | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const actionTimerRef = useRef<number | null>(null);
  const [primaryKeys, setPrimaryKeys] = useState<string[] | null>(null);
  const [saveBlockedReason, setSaveBlockedReason] = useState<string | null>(null);
  const [preview, setPreview] = useState<UpdatePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [executingUpdates, setExecutingUpdates] = useState(false);
  const [openingPreview, setOpeningPreview] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(
    null,
  );

  const dirtyCount = useSyncExternalStore(
    (onStoreChange) => QueryResultDirtyService.onDidChange(onStoreChange),
    () => QueryResultDirtyService.getDirtyCount(tabId),
    () => QueryResultDirtyService.getDirtyCount(tabId),
  );

  const deletedRowCount = useSyncExternalStore(
    (onStoreChange) => QueryResultDirtyService.onDidChange(onStoreChange),
    () => QueryResultDirtyService.getDeletedRowCount(tabId),
    () => QueryResultDirtyService.getDeletedRowCount(tabId),
  );

  const newRowCount = useSyncExternalStore(
    (onStoreChange) => QueryResultDirtyService.onDidChange(onStoreChange),
    () => QueryResultDirtyService.getNewRowCount(tabId),
    () => QueryResultDirtyService.getNewRowCount(tabId),
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
        width: 56,
        minWidth: 40,
        pinned: "left",
        lockPosition: "left",
        suppressMovable: true,
        editable: false,
        sortable: false,
        filter: false,
        floatingFilter: false,
        resizable: true,
        suppressHeaderMenuButton: true,
        // Keeps this column out of the auto-fit-to-content pass (see
        // QueryResultGridService.autoSizeToContent's "keep the row-number gutter fixed width"
        // comment) — doesn't affect manual drag-resize, which `resizable: true` above enables.
        suppressAutoSize: true,
      },
      ...result.columns.map((column) => ({
        colId: column,
        field: column,
        headerName: column,
        filter: filterEnabled ? "agTextColumnFilter" : false,
        floatingFilter: filterEnabled,
        // Both modes require an explicit Apply (click or Enter) rather than filtering per
        // keystroke — in Infinite Row Model mode this is a hard requirement (each Apply re-queries
        // the database); in Client-Side Row Model mode it's kept identical on purpose so the
        // interaction never changes depending on an invisible "is this result large" state.
        filterParams: { buttons: ["apply", "reset"] },
        // Editing is always allowed except for known PK columns on an *existing* row (they
        // identify which row an UPDATE/DELETE targets, so editing them would let a saved edit
        // silently retarget a different row), or on a row marked for deletion (it won't exist
        // after Save, so an edit there would be pointless/lost). A new/duplicated row has no
        // saved identity yet to protect — its PK columns start blank precisely so the user can
        // fill them in, so they're editable like any other column. Infinite Row Model rows are
        // editable too — `QueryResultDirtyService.appendOriginalRows` (called from the
        // datasource's success callback) keeps every loaded page's original values available for
        // the safe-UPDATE WHERE clause, not just the tab's first batch.
        editable: (params: { data?: QueryResultRow }) => {
          const rowIndex = params.data ? getQueryResultRowIndex(params.data) : null;
          const isNew = rowIndex != null && QueryResultDirtyService.isNewRow(tabId, rowIndex);
          if (
            !isNew &&
            primaryKeys != null &&
            primaryKeys.length > 0 &&
            primaryKeySet.has(column)
          ) {
            return false;
          }
          return rowIndex == null || !QueryResultDirtyService.isRowDeleted(tabId, rowIndex);
        },
        sortable: true,
        resizable: true,
        unSortIcon: true,
        minWidth: 80,
        maxWidth: 480,
        valueFormatter: formatCellValue,
      })),
    ],
    [
      filterEnabled,
      formatCellValue,
      primaryKeySet,
      primaryKeys,
      result.columns,
      tabId,
      useInfiniteMode,
    ],
  );

  const rowData = useMemo(
    () => toQueryResultRows(result.columns, result.rows),
    [result.columns, result.rows],
  );

  const defaultColDef = useMemo<ColDef>(
    () => ({
      filter: filterEnabled ? "agTextColumnFilter" : false,
      floatingFilter: filterEnabled,
      filterParams: { buttons: ["apply", "reset"] },
      editable: true,
      sortable: true,
      resizable: true,
      unSortIcon: true,
      sortingOrder: ["asc", "desc", null],
    }),
    [filterEnabled],
  );

  /**
   * Backs the grid's Infinite Row Model in `useInfiniteMode` — re-runs the tab's original SQL
   * wrapped with server-side offset/limit pagination and a translated filter/sort
   * (`query_execute_paged`) per requested block.
   */
  const datasource = useMemo<IDatasource | undefined>(() => {
    if (!useInfiniteMode || !connectionId) return undefined;
    const pagingSql = executedSql ?? sql;
    return {
      getRows: (params: IGetRowsParams) => {
        const limit = params.endRow - params.startRow;
        const filters = translateFilterModel(params.filterModel, result.columns);
        const sortColumns = translateSortModel(params.sortModel, result.columns);
        fetchQueryResultPage(connectionId, pagingSql, result.columns, params.startRow, limit, {
          binds,
          filters,
          sort: sortColumns,
        })
          .then((payload) => {
            QueryResultDirtyService.appendOriginalRows(
              tabId,
              params.startRow,
              payload.columns,
              payload.rows,
            );
            const rows = toQueryResultRows(payload.columns, payload.rows, params.startRow);
            const lastRow = rows.length < limit ? params.startRow + rows.length : -1;
            params.successCallback(rows, lastRow);
          })
          .catch((error) => {
            console.warn("[query-result] paged fetch failed", error);
            flashMessage(
              t("app.query.pagedFetchFailed").replace(
                "{message}",
                formatErrorMessage(error, ""),
              ),
            );
            params.failCallback();
          });
      },
    };
  }, [useInfiniteMode, connectionId, executedSql, sql, binds, result.columns, tabId]);

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

  /**
   * In Infinite Row Model mode, `__rowIndex` means "this row's position under the *current*
   * filter/sort" — changing either reassigns every index to a different underlying DB row once
   * the grid re-fetches. Any pending edit tracked against an index would then silently attach to
   * the wrong row's original values once that index's new page loads (`appendOriginalRows`
   * overwrites the snapshot, but the dirty *edit* itself doesn't know its row moved). Discarding
   * pending edits here is the safe response — CSRM mode doesn't need this: filtering/sorting there
   * only changes what's *displayed*, never each row's own `__rowIndex`/original snapshot.
   */
  const discardStaleEditsOnReshuffle = () => {
    if (!useInfiniteMode || !QueryResultDirtyService.hasPendingChanges(tabId)) {
      return;
    }
    QueryResultDirtyService.clearTab(tabId);
    flashMessage(t("app.query.pendingEditsDiscardedOnReshuffle"));
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

  /**
   * Toggles the pending-delete mark on every selected row (mixed selections un-mark already-
   * marked rows and mark the rest — matches how most grids treat a repeat action on a mixed
   * selection). Only flips the row's own `dirty`/style state; the actual DELETE only runs after
   * Save is confirmed.
   *
   * A selected row added via "Add row"/"Duplicate row" (not yet saved) is handled differently:
   * there's nothing in the database to target with a DELETE, so it's discarded outright and
   * removed from the grid instead of being marked.
   */
  const handleToggleDeleteRows = () => {
    const api = apiRef.current;
    const selectedRows = api?.getSelectedRows() ?? [];
    if (selectedRows.length === 0) {
      flashMessage(t("app.query.selectRowFirst"));
      return;
    }
    const newRowNodes: NonNullable<ReturnType<GridApi["getRowNode"]>>[] = [];
    const existingRows: QueryResultRow[] = [];
    for (const row of selectedRows) {
      const rowIndex = getQueryResultRowIndex(row);
      if (QueryResultDirtyService.isNewRow(tabId, rowIndex)) {
        QueryResultDirtyService.discardNewRow(tabId, rowIndex);
        const node = api?.getRowNode(String(rowIndex));
        if (node) newRowNodes.push(node);
      } else {
        QueryResultDirtyService.toggleRowDeleted(tabId, rowIndex);
        existingRows.push(row);
      }
    }
    if (api && newRowNodes.length > 0) {
      const newRowData = newRowNodes
        .map((node) => node.data)
        .filter((data): data is QueryResultRow => data != null);
      if (newRowData.length > 0) {
        api.applyTransaction({ remove: newRowData });
      }
    }
    // rowClassRules is a fresh object identity every render, but AG Grid doesn't re-evaluate it
    // just because a prop changed reference — force it explicitly so the strikethrough/background
    // shows immediately instead of waiting for some unrelated redraw (sort, filter, resize...).
    if (api && existingRows.length > 0) {
      const rowNodes = existingRows
        .map((row) => api.getRowNode(String(getQueryResultRowIndex(row))))
        .filter((node) => node != null);
      api.redrawRows({ rowNodes });
    }
  };

  /** Builds a full grid row object (all result columns + stamped `__rowIndex`) for `applyTransaction`. */
  const buildGridRow = (
    rowIndex: number,
    values: Record<string, string | null>,
  ): QueryResultRow => {
    const row: QueryResultRow = { [QUERY_RESULT_ROW_INDEX_KEY]: String(rowIndex) };
    result.columns.forEach((column) => {
      row[column] = values[column] ?? null;
    });
    return row;
  };

  /**
   * Adds a blank row right after the (single) selected row — matching where "Duplicate row"
   * inserts — or at the top when nothing is selected, and starts editing its first cell
   * immediately.
   */
  const handleAddRow = () => {
    const api = apiRef.current;
    if (!api) return;
    const selectedRows = api.getSelectedRows();
    const selectedNode =
      selectedRows.length === 1
        ? api.getRowNode(String(getQueryResultRowIndex(selectedRows[0])))
        : undefined;
    const addIndex = selectedNode?.rowIndex != null ? selectedNode.rowIndex + 1 : 0;

    const rowIndex = QueryResultDirtyService.addNewRow(tabId, result.columns);
    if (rowIndex == null) return;
    const row = buildGridRow(rowIndex, {});
    api.applyTransaction({ add: [row], addIndex });
    // Clicking a cell to focus it also selects that row (rowSelection.enableClickSelection) —
    // do the same here so the *new* row reads as selected instead of leaving the row it was
    // inserted after (still selected from before Add was clicked) looking selected alongside it.
    api.getRowNode(String(rowIndex))?.setSelected(true, true);
    const firstColumn = result.columns[0];
    if (firstColumn) {
      api.ensureIndexVisible(addIndex);
      api.setFocusedCell(addIndex, firstColumn);
      api.startEditingCell({ rowIndex: addIndex, colKey: firstColumn });
    }
  };

  /** Duplicates exactly one selected row, blanking its PK column(s) — see `duplicateRow`'s doc. */
  const handleDuplicateRow = () => {
    const api = apiRef.current;
    const selectedRows = api?.getSelectedRows() ?? [];
    if (selectedRows.length !== 1) {
      flashMessage(t("app.query.duplicateRowSelectOne"));
      return;
    }
    if (!api) return;
    const sourceRow = selectedRows[0];
    const sourceRowIndex = getQueryResultRowIndex(sourceRow);
    const sourceNode = api.getRowNode(String(sourceRowIndex));
    const rowIndex = QueryResultDirtyService.duplicateRow(tabId, sourceRowIndex);
    if (rowIndex == null) return;
    const values = QueryResultDirtyService.getEffectiveRow(tabId, rowIndex) ?? {};
    const row = buildGridRow(rowIndex, values);
    const addIndex =
      sourceNode?.rowIndex != null ? sourceNode.rowIndex + 1 : 0;
    api.applyTransaction({ add: [row], addIndex });
    // See handleAddRow's comment — moves the selection highlight to the new row instead of
    // leaving it on the source row it was duplicated from.
    api.getRowNode(String(rowIndex))?.setSelected(true, true);
    const firstColumn = result.columns[0];
    if (firstColumn) {
      api.ensureIndexVisible(addIndex);
      api.setFocusedCell(addIndex, firstColumn);
    }
  };

  /**
   * Discards every pending change for this tab without saving: restores edited cells to their
   * original values (via `setDataValue`, which re-fires `onCellValueChanged` and lets the normal
   * dirty-clearing logic run), removes added/duplicated rows from the grid, and un-marks rows
   * pending deletion.
   */
  const handleCancelChanges = () => {
    const api = apiRef.current;
    if (api) {
      for (const row of QueryResultDirtyService.getDirtyRows(tabId)) {
        if (QueryResultDirtyService.isNewRow(tabId, row.rowIndex)) continue;
        const node = api.getRowNode(String(row.rowIndex));
        if (!node) continue;
        for (const change of row.changes) {
          node.setDataValue(change.column, change.originalValue);
        }
      }
      const newRowData = QueryResultDirtyService.getNewRowIndexes(tabId)
        .map((rowIndex) => api.getRowNode(String(rowIndex))?.data)
        .filter((data): data is QueryResultRow => data != null);
      if (newRowData.length > 0) {
        api.applyTransaction({ remove: newRowData });
      }
      const deletedNodes = QueryResultDirtyService.getDeletedRowIndexes(tabId)
        .map((rowIndex) => api.getRowNode(String(rowIndex)))
        .filter((node) => node != null);
      if (deletedNodes.length > 0) {
        api.redrawRows({ rowNodes: deletedNodes });
      }
    }
    QueryResultDirtyService.clearTab(tabId);
    flashMessage(t("app.query.changesCancelled"));
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

  const gridContextMenuItems: ContextMenuItem[] = [
    { id: "copySelection", label: t("app.query.copySelection"), enabled: true },
    { id: "copyRows", label: t("app.query.copySelectedRows"), enabled: true },
    { id: "copyAll", label: t("app.query.copyAllFiltered"), enabled: true },
    {
      id: "exportCsv",
      label: t("app.query.exportCsv"),
      enabled: true,
      separator: true,
    },
    {
      id: "clearFilters",
      label: t("app.query.clearFilters"),
      enabled: snapshot.filterActive || snapshot.sortActive,
      separator: true,
    },
  ];

  function handleGridContextMenuSelect(item: ContextMenuItem) {
    switch (item.id) {
      case "copySelection":
        void handleCopySelection();
        return;
      case "copyRows":
        void handleCopyRows();
        return;
      case "copyAll":
        void handleCopyAll();
        return;
      case "exportCsv":
        void handleExportCsv();
        return;
      case "clearFilters":
        handleClearFilters();
        return;
      default:
        return;
    }
  }

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

  const pendingChangeCount = dirtyCount + deletedRowCount + newRowCount;

  const saveHint =
    saveBlockedReason ??
    getSaveBlockedReason(sql, pendingChangeCount, { relationKind });

  const canAttemptSave = pendingChangeCount > 0 && !saveBlockedReason;

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
          {deletedRowCount > 0 ? (
            <span
              className="query-result-grid__badge query-result-grid__badge--deleted"
              title={t("app.query.deletedRowsTitle").replace(
                "{n}",
                String(deletedRowCount),
              )}
            >
              {t("app.query.badgeDeleted").replace("{n}", String(deletedRowCount))}
            </span>
          ) : null}
          {newRowCount > 0 ? (
            <span
              className="query-result-grid__badge query-result-grid__badge--new"
              title={t("app.query.newRowsTitle").replace("{n}", String(newRowCount))}
            >
              {t("app.query.badgeNew").replace("{n}", String(newRowCount))}
            </span>
          ) : null}
          {truncated ? (
            <span
              className="query-result-grid__badge query-result-grid__badge--warn"
              title={
                useInfiniteMode
                  ? t("app.query.scrollableTitle")
                  : t("app.query.truncatedTitle").replace(
                      "{n}",
                      maxRows.toLocaleString(),
                    )
              }
            >
              {useInfiniteMode
                ? t("app.query.badgeScrollable")
                : t("app.query.badgeTruncated").replace(
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
            title={t("app.query.cancelChangesTitle")}
            aria-label={t("app.query.cancelChanges")}
            disabled={pendingChangeCount === 0}
            onClick={handleCancelChanges}
          >
            <Codicon name="discard" />
          </button>
          <button
            type="button"
            className="query-result-grid__action"
            title={
              useInfiniteMode
                ? t("app.query.rowAddDisabledInfiniteMode")
                : t("app.query.addRowTitle")
            }
            aria-label={t("app.query.addRow")}
            disabled={useInfiniteMode}
            onClick={handleAddRow}
          >
            <Codicon name="add" />
          </button>
          <button
            type="button"
            className="query-result-grid__action"
            title={
              useInfiniteMode
                ? t("app.query.rowAddDisabledInfiniteMode")
                : t("app.query.duplicateRowTitle")
            }
            aria-label={t("app.query.duplicateRow")}
            disabled={useInfiniteMode}
            onClick={handleDuplicateRow}
          >
            <Codicon name="files" />
          </button>
          <button
            type="button"
            className="query-result-grid__action"
            title={t("app.query.deleteRowTitle")}
            aria-label={t("app.query.deleteRow")}
            onClick={handleToggleDeleteRows}
          >
            <Codicon name="trash" />
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
      <div
        className="query-result-grid__body"
        onContextMenu={(event) => {
          event.preventDefault();
          setContextMenu({ x: event.clientX, y: event.clientY });
        }}
      >
        <AgGridReact<QueryResultRow>
          // Row model is effectively fixed for a grid instance's lifetime — remount (rather than
          // toggle rowModelType live) if a refresh flips this same tab between modes.
          key={useInfiniteMode ? "infinite" : "csrm"}
          theme={gridTheme}
          columnDefs={columnDefs}
          {...(useInfiniteMode
            ? {
                rowModelType: "infinite" as const,
                datasource,
                cacheBlockSize: INFINITE_SCROLL_BLOCK_SIZE,
              }
            : { rowData })}
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
          rowClassRules={{
            "query-result-grid__row--deleted": (params) => {
              if (!params.data) return false;
              return QueryResultDirtyService.isRowDeleted(
                tabId,
                getQueryResultRowIndex(params.data),
              );
            },
            "query-result-grid__row--new": (params) => {
              if (!params.data) return false;
              return QueryResultDirtyService.isNewRow(
                tabId,
                getQueryResultRowIndex(params.data),
              );
            },
          }}
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
            discardStaleEditsOnReshuffle();
            QueryResultGridService.refreshSnapshot();
            captureGridUiState();
          }}
          onSortChanged={() => {
            discardStaleEditsOnReshuffle();
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

      {contextMenu ? (
        <ContextMenu
          anchor={{ top: contextMenu.y, left: contextMenu.x }}
          items={gridContextMenuItems}
          onClose={() => setContextMenu(null)}
          onSelect={handleGridContextMenuSelect}
        />
      ) : null}

      {preview ? (
        <QueryResultUpdateDialog
          tableLabel={tableLabel}
          dirtyRowCount={preview.dirtyRowCount}
          dirtyCellCount={preview.dirtyCellCount}
          deletedRowCount={preview.deletedRowCount}
          insertedRowCount={preview.insertedRowCount}
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
