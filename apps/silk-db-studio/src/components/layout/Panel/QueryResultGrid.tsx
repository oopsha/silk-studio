import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type CellContextMenuEvent,
  type CellEditorSelectorFunc,
  type CellDoubleClickedEvent,
  type CellMouseDownEvent,
  type CellMouseOverEvent,
  type CellClassParams,
  type CellValueChangedEvent,
  type ColDef,
  type ColumnState,
  type FirstDataRenderedEvent,
  type GridApi,
  type GridReadyEvent,
  type NavigateToNextCellParams,
  type ValueFormatterParams,
  type ValueParserParams,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { useConfiguration } from "@silk-studio/workbench/platform/configuration/useConfiguration.ts";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import {
  resolveEffectiveColorTheme,
  type EffectiveColorThemeId,
} from "@silk-studio/ui/platform/colorTheme.ts";
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
import { QueryResultDirtyService } from "../../../services/query/queryResultDirtyService";
import { formatErrorMessage } from "../../../services/formatErrorMessage";
import { ConfirmDialogService } from "../../../services/ui/confirmDialogService";
import {
  buildUpdatePreview,
  executeConfirmedUpdates,
  getSaveBlockedReason,
  resolveUpdateEligibility,
  type QueryRelationKind,
  type UpdatePreview,
} from "../../../services/query/queryResultUpdateService";
import QueryResultUpdateDialog from "./QueryResultUpdateDialog";
import QueryResultValueEditorDialog from "./QueryResultValueEditorDialog";
import MaskedTemporalCellEditor from "./MaskedTemporalCellEditor";
import {
  CURRENT_TIMESTAMP_VALUE,
  isCurrentTimestampValue,
} from "../../../services/query/queryResultTemporalValue";
import "./QueryResultGrid.css";
import "./QueryResultUpdateDialog.css";

ModuleRegistry.registerModules([AllCommunityModule]);

type GridUiState = {
  filterModel: Record<string, unknown>;
  sortState: ColumnState[];
};

type GridContextMenuState =
  | { kind: "data"; x: number; y: number }
  | { kind: "header"; x: number; y: number; columnId: string }
  | { kind: "filter"; x: number; y: number; columnId: string };

type FilterInput = HTMLInputElement | HTMLTextAreaElement;

type GridCellSelection = {
  anchorRowIndex: number;
  focusRowIndex: number;
  anchorColumnIndex: number;
  focusColumnIndex: number;
};

type ValueEditorTarget = {
  rowIndex: number;
  column: string;
  columnIndex: number;
  value: string | null;
  valueIsTruncated: boolean;
  editorKind: "text" | "date" | "time" | "datetime";
};

const LARGE_TEXT_JDBC_TYPES = new Set([-1, -16, 2005, 2011]);
const DATE_JDBC_TYPE = 91;
const TIME_JDBC_TYPE = 92;
const TIMESTAMP_JDBC_TYPES = new Set([93, 2013, 2014]);

/**
 * Filter/sort survive a remount of the *same* result tab (e.g. the Object
 * Editor's Data tab unmounting when the user switches to another editor tab
 * and back) — ag-grid itself only keeps this in the DOM-mounted instance.
 */
const gridUiStateByTabId = new Map<string, GridUiState>();

/**
 * Next-page size for a result that was initially truncated. We deliberately retain AG Grid's
 * Client-Side Row Model and append server pages ourselves: local added/duplicated rows can then
 * coexist with the loaded rows and keep a stable identity while more data arrives.
 */
const INCREMENTAL_SCROLL_PAGE_SIZE = 100;

const GRID_THEME_PALETTES: Record<
  EffectiveColorThemeId,
  {
    backgroundColor: string;
    headerBackgroundColor: string;
    oddRowBackgroundColor: string;
    rowHoverColor: string;
    borderColor: string;
    inputBackgroundColor: string;
    foregroundColor: string;
    inputBorderColor: string;
    selectedRowBackgroundColor: string;
  }
> = {
  dark: {
    backgroundColor: "#191a1b",
    headerBackgroundColor: "#202122",
    oddRowBackgroundColor: "#1e1f20",
    rowHoverColor: "#242526",
    borderColor: "#2a2b2c",
    inputBackgroundColor: "#121314",
    foregroundColor: "#bfbfbf",
    inputBorderColor: "#333536",
    selectedRowBackgroundColor: "rgba(57, 148, 188, 0.22)",
  },
  // VS Code 2026-light.json — list/editor colors.
  light: {
    backgroundColor: "#fafafd",
    headerBackgroundColor: "#eaeaea",
    oddRowBackgroundColor: "#f5f5f7",
    rowHoverColor: "rgba(0, 0, 0, 0.06)",
    borderColor: "#f0f1f2",
    inputBackgroundColor: "#ffffff",
    foregroundColor: "#202020",
    inputBorderColor: "#d8d8d8",
    selectedRowBackgroundColor: "rgba(0, 105, 204, 0.15)",
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
  // A truncated result keeps its initial batch and appends subsequent pages on demand. Unlike AG
  // Grid's Infinite Row Model, this lets Client-Side transactions add/duplicate rows safely.
  const useIncrementalScroll = truncated && !!connectionId?.trim();
  const apiRef = useRef<GridApi<QueryResultRow> | null>(null);
  // Display-row index at which the current multi-row selection began. This deliberately tracks
  // the displayed position (rather than the database row id), so Shift selection follows the
  // user's current sort/filter order.
  const rowSelectionAnchorRef = useRef<number | null>(null);
  const pagingRef = useRef({
    nextOffset: result.rows.length,
    hasMore: useIncrementalScroll,
    loading: false,
  });
  const cellSelectionRef = useRef<GridCellSelection | null>(null);
  const draggingCellSelectionRef = useRef(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const actionTimerRef = useRef<number | null>(null);
  const [saveBlockedReason, setSaveBlockedReason] = useState<string | null>(null);
  const [preview, setPreview] = useState<UpdatePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [executingUpdates, setExecutingUpdates] = useState(false);
  const [openingPreview, setOpeningPreview] = useState(false);
  const [contextMenu, setContextMenu] = useState<GridContextMenuState | null>(null);
  const [valueEditorTarget, setValueEditorTarget] = useState<ValueEditorTarget | null>(null);
  const filterContextInputRef = useRef<FilterInput | null>(null);

  useEffect(() => {
    const stopCellSelectionDrag = () => {
      draggingCellSelectionRef.current = false;
    };
    window.addEventListener("mouseup", stopCellSelectionDrag);
    return () => window.removeEventListener("mouseup", stopCellSelectionDrag);
  }, []);

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
    (value: unknown, columnIndex?: number): string | null => {
      if (value === null || value === undefined) {
        return null;
      }
      const text = String(value);
      if (text === nullDisplay) {
        return null;
      }
      return columnIndex == null
        ? text
        : normalizeTemporalValue(text, result.columnTypes?.[columnIndex]);
    },
    [nullDisplay, result.columnTypes],
  );

  const isLargeTextColumn = useCallback((columnIndex: number) => {
    const columnType = result.columnTypes?.[columnIndex];
    if (!columnType) return false;
    return LARGE_TEXT_JDBC_TYPES.has(columnType.jdbcType) || /^(?:CLOB|NCLOB|TEXT|LONG(?:\s+)?VARCHAR|LONG(?:\s+)?NVARCHAR)/i.test(columnType.typeName);
  }, [result.columnTypes]);

  const supportsValueEditor = useCallback((columnIndex: number, value: string | null) => {
    return isLargeTextColumn(columnIndex) || temporalEditorKind(result.columnTypes?.[columnIndex], value) != null || Boolean(value?.includes("\n") || value?.includes("\r"));
  }, [isLargeTextColumn, result.columnTypes]);

  const getValueEditorKind = useCallback((columnIndex: number, value: string | null) => {
    return temporalEditorKind(result.columnTypes?.[columnIndex], value) ?? "text";
  }, [result.columnTypes]);

  const shouldOpenTextValueEditorOnEnter = useCallback(() => {
    const api = apiRef.current;
    const focused = api?.getFocusedCell();
    const field = focused?.column.getColDef().field;
    if (!api || !focused || typeof field !== "string") return false;
    const columnIndex = result.columns.indexOf(field);
    const row = api.getDisplayedRowAtIndex(focused.rowIndex)?.data;
    if (!row || columnIndex < 0) return false;
    const value = row[field] ?? null;
    return isLargeTextColumn(columnIndex) || Boolean(value?.includes("\n") || value?.includes("\r"));
  }, [isLargeTextColumn, result.columns]);

  const openValueEditor = useCallback(() => {
    const api = apiRef.current;
    const focused = api?.getFocusedCell();
    if (!api || !focused || focused.rowIndex == null) return;
    const field = focused.column.getColDef().field;
    if (typeof field !== "string") return;
    const columnIndex = result.columns.indexOf(field);
    const row = api.getDisplayedRowAtIndex(focused.rowIndex)?.data;
    if (!row || columnIndex < 0 || !supportsValueEditor(columnIndex, row[field] ?? null)) return;
    const sourceRowIndex = getQueryResultRowIndex(row);
    setValueEditorTarget({
      rowIndex: sourceRowIndex,
      column: field,
      columnIndex,
      value: row[field] ?? null,
      valueIsTruncated: result.lobTruncated?.[sourceRowIndex]?.[columnIndex] === true,
      editorKind: getValueEditorKind(columnIndex, row[field] ?? null),
    });
  }, [getValueEditorKind, result.columns, result.lobTruncated, supportsValueEditor]);

  useEffect(() => {
    // No cleanup here: tab lifecycle (removeTab/removeTabs) is owned by
    // queryExecutionService, which clears a result tab's dirty store when it's actually
    // closed or replaced by a new query run — not by this component's mount/unmount, since
    // switching to another editor tab and back remounts the *same* result tab and must not
    // lose pending edits. See QueryResultDirtyService.initTab's own no-op-if-exists guard.
    QueryResultDirtyService.initTab(tabId, result.columns, result.rows);
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
        setSaveBlockedReason(null);
        return;
      }
      setSaveBlockedReason(eligibility.reason);
    },
    );
    return () => {
      cancelled = true;
    };
  }, [sql, result.columns, relationKind, connectionId]);

  const gridTheme = useMemo(() => {
    const palette = GRID_THEME_PALETTES[resolveEffectiveColorTheme(colorTheme)];
    return themeQuartz.withParams({
      backgroundColor: palette.backgroundColor,
      dataBackgroundColor: palette.backgroundColor,
      foregroundColor: palette.foregroundColor,
      borderColor: palette.borderColor,
      headerBackgroundColor: palette.headerBackgroundColor,
      headerTextColor: palette.foregroundColor,
      headerFontWeight: 600,
      headerRowBorder: false,
      headerColumnBorder: false,
      oddRowBackgroundColor: palette.oddRowBackgroundColor,
      rowBorder: false,
      rowHoverColor: palette.rowHoverColor,
      selectedRowBackgroundColor: palette.selectedRowBackgroundColor,
      inputBackgroundColor: palette.inputBackgroundColor,
      inputTextColor: palette.foregroundColor,
      inputBorder: { color: palette.inputBorderColor },
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
      (
        params: ValueFormatterParams<QueryResultRow>,
        columnType?: NonNullable<QueryResultPayload["columnTypes"]>[number],
      ): string => {
        if (params.value === null || params.value === undefined) {
          return nullDisplay;
        }
        if (isCurrentTimestampValue(String(params.value))) {
          return t("app.query.currentTimeValue");
        }
        return normalizeTemporalValue(String(params.value), columnType).replace(/\r?\n/g, " ↵ ");
    },
    [nullDisplay, t],
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
        // Require an explicit Apply (click or Enter) rather than filtering per keystroke. The
        // same client-side behaviour applies before and after incremental pages are appended.
        filterParams: { buttons: ["apply", "reset"] },
        // Existing PK values are editable just like DBeaver. Saving remains safe because
        // `safeUpdateSql` uses the value from the original loaded row in its WHERE clause and
        // the edited PK value only in SET. Deleted rows are not editable because they won't
        // exist after Save. `QueryResultDirtyService.appendOriginalRows` keeps each incrementally
        // loaded page's original values available for the safe-UPDATE WHERE clause, not just the
        // tab's first batch.
        editable: (params: { data?: QueryResultRow }) => {
          const rowIndex = params.data ? getQueryResultRowIndex(params.data) : null;
          return rowIndex == null || !QueryResultDirtyService.isRowDeleted(tabId, rowIndex);
        },
        sortable: true,
        resizable: true,
        unSortIcon: true,
        minWidth: 80,
        maxWidth: 480,
        cellEditorSelector: ((params) => {
          const editorKind = temporalEditorKind(
            result.columnTypes?.[result.columns.indexOf(column)],
            params.value ?? null,
          );
          return editorKind
            ? {
                component: MaskedTemporalCellEditor,
                params: { editorKind },
              }
            : undefined;
        }) as CellEditorSelectorFunc<QueryResultRow>,
        valueFormatter: (params: ValueFormatterParams<QueryResultRow>) =>
          formatCellValue(params, result.columnTypes?.[result.columns.indexOf(column)]),
        valueParser: (params: ValueParserParams<QueryResultRow>) =>
          normalizeEditedValue(
            params.newValue,
            result.columns.indexOf(column),
          ),
        cellClassRules: {
          "query-result-grid__cell--range-selected": (
            params: CellClassParams<QueryResultRow>,
          ) => {
            const selection = cellSelectionRef.current;
            const rowIndex = params.node.rowIndex;
            const columnIndex = result.columns.indexOf(column);
            if (!selection || rowIndex == null || columnIndex < 0) return false;
            const firstRow = Math.min(
              selection.anchorRowIndex,
              selection.focusRowIndex,
            );
            const lastRow = Math.max(
              selection.anchorRowIndex,
              selection.focusRowIndex,
            );
            const firstColumn = Math.min(
              selection.anchorColumnIndex,
              selection.focusColumnIndex,
            );
            const lastColumn = Math.max(
              selection.anchorColumnIndex,
              selection.focusColumnIndex,
            );
            return (
              rowIndex >= firstRow &&
              rowIndex <= lastRow &&
              columnIndex >= firstColumn &&
              columnIndex <= lastColumn
            );
          },
        },
      })),
    ],
    [
      filterEnabled,
      formatCellValue,
      normalizeEditedValue,
      result.columns,
      result.columnTypes,
      tabId,
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
    QueryResultGridService.attach(api, result.columns, nullDisplay, openValueEditor);
    // New result while the grid is already mounted — size after paint.
    const frame = window.requestAnimationFrame(() => {
      QueryResultGridService.autoSizeToContent();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [nullDisplay, openValueEditor, result.columns, result.rows]);

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
   * Loads the next server page into the Client-Side Row Model. Existing rows retain their stable
   * result index and locally added/duplicated rows remain in their transaction position, which is
   * the same separation of remote rows and local edit changes used by DevExtreme.
   */
  const loadNextPage = useCallback(async () => {
    const api = apiRef.current;
    const paging = pagingRef.current;
    if (!api || !useIncrementalScroll || !connectionId || paging.loading || !paging.hasMore) {
      return;
    }

    paging.loading = true;
    const offset = paging.nextOffset;
    try {
      const payload = await fetchQueryResultPage(
        connectionId,
        executedSql ?? sql,
        result.columns,
        offset,
        INCREMENTAL_SCROLL_PAGE_SIZE,
        { binds },
      );
      const rows = toQueryResultRows(payload.columns, payload.rows, offset);
      QueryResultDirtyService.appendOriginalRows(
        tabId,
        offset,
        payload.columns,
        payload.rows,
      );
      if (rows.length > 0) {
        api.applyTransaction({ add: rows });
      }
      paging.nextOffset += rows.length;
      // A full page may still be the final page. One cheap final empty-page request is preferable
      // to assuming an inaccurate total count from a JDBC driver.
      paging.hasMore = rows.length === INCREMENTAL_SCROLL_PAGE_SIZE;
    } catch (error) {
      console.warn("[query-result] incremental page fetch failed", error);
      paging.hasMore = false;
      flashMessage(
        t("app.query.pagedFetchFailed").replace(
          "{message}",
          formatErrorMessage(error, ""),
        ),
      );
    } finally {
      paging.loading = false;
    }
  }, [binds, connectionId, executedSql, result.columns, sql, tabId, t, useIncrementalScroll]);

  const handleBodyScrollEnd = useCallback(() => {
    const api = apiRef.current;
    if (!api || !useIncrementalScroll) return;
    const lastVisibleRow = api.getLastDisplayedRowIndex();
    const displayedRowCount = api.getDisplayedRowCount();
    if (displayedRowCount > 0 && lastVisibleRow >= displayedRowCount - 3) {
      void loadNextPage();
    }
  }, [loadNextPage, useIncrementalScroll]);

  useEffect(() => {
    pagingRef.current = {
      nextOffset: result.rows.length,
      hasMore: useIncrementalScroll,
      loading: false,
    };
  }, [result.rows, useIncrementalScroll]);

  const handleGridReady = (event: GridReadyEvent<QueryResultRow>) => {
    apiRef.current = event.api;
    QueryResultGridService.attach(event.api, result.columns, nullDisplay, openValueEditor);

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

  /**
   * Replays pending edits back onto a freshly (re)mounted grid instance. `QueryResultDirtyService`
   * survives a remount (e.g. switching to another editor tab and back), but AG Grid itself doesn't:
   * `rowData` is recomputed from the original `result.rows` and a brand-new grid instance is
   * created, so added/duplicated rows and edited cell values — both applied to the *previous*
   * instance imperatively (`applyTransaction`/`setDataValue`) — need to be reapplied here.
   * Deleted-row and new-row *styling* doesn't need this: `rowClassRules` re-evaluates
   * `QueryResultDirtyService` against each row on every render, so it self-heals once the row
   * exists — but a new row's row node doesn't exist at all until re-added below.
   */
  const rehydratePendingEdits = () => {
    const api = apiRef.current;
    if (!api || !QueryResultDirtyService.hasPendingChanges(tabId)) return;

    for (const row of QueryResultDirtyService.getDirtyRows(tabId)) {
      if (QueryResultDirtyService.isNewRow(tabId, row.rowIndex)) continue;
      const node = api.getRowNode(String(row.rowIndex));
      if (!node) continue;
      for (const change of row.changes) {
        node.setDataValue(change.column, change.currentValue);
      }
    }

    // Oldest-first (see getNewRowIndexes' doc) — each row is re-added individually, right after
    // its recorded anchor, so a row anchored to an *earlier* new row lands in the right spot
    // once that earlier row already has a grid node.
    for (const rowIndex of QueryResultDirtyService.getNewRowIndexes(tabId)) {
      const row = buildGridRow(
        rowIndex,
        QueryResultDirtyService.getEffectiveRow(tabId, rowIndex) ?? {},
      );
      const anchor = QueryResultDirtyService.getNewRowAnchor(tabId, rowIndex);
      const anchorNode = anchor != null ? api.getRowNode(String(anchor)) : undefined;
      const addIndex = anchorNode?.rowIndex != null ? anchorNode.rowIndex + 1 : 0;
      api.applyTransaction({ add: [row], addIndex });
    }
  };

  const handleFirstDataRendered = (
    _event: FirstDataRenderedEvent<QueryResultRow>,
  ) => {
    rehydratePendingEdits();
    QueryResultGridService.autoSizeToContent();
    // A small configured initial-result limit can leave the viewport already at the end, with no
    // physical scroll event to trigger the first append.
    window.requestAnimationFrame(handleBodyScrollEnd);
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
      normalizeEditedValue(event.newValue, result.columns.indexOf(field)),
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
    const insertAfter = selectedNode?.data ? getQueryResultRowIndex(selectedNode.data) : null;

    const rowIndex = QueryResultDirtyService.addNewRow(tabId, result.columns, insertAfter);
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
      applyCellSelection(addIndex, 0, addIndex, 0);
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
      // The custom cell-range paint is independent of AG Grid's row selection. Move it as
      // well, otherwise the source cell remains painted after its duplicate is inserted.
      applyCellSelection(addIndex, 0, addIndex, 0);
    }
  };

  const applyCellSelection = (
    anchorRowIndex: number,
    anchorColumnIndex: number,
    focusRowIndex: number,
    focusColumnIndex: number,
  ) => {
    const selection = {
      anchorRowIndex,
      anchorColumnIndex,
      focusRowIndex,
      focusColumnIndex,
    };
    cellSelectionRef.current = selection;

    const firstColumn = Math.min(anchorColumnIndex, focusColumnIndex);
    const lastColumn = Math.max(anchorColumnIndex, focusColumnIndex);
    QueryResultGridService.setCellSelection(
      result.columns.slice(firstColumn, lastColumn + 1),
      anchorRowIndex,
      focusRowIndex,
    );
    apiRef.current?.refreshCells({ force: true });
  };

  const handleCellMouseDown = (event: CellMouseDownEvent<QueryResultRow>) => {
    const mouseEvent = event.event;
    if (
      !(mouseEvent instanceof MouseEvent) ||
      mouseEvent.button !== 0 ||
      event.rowIndex == null
    ) {
      return;
    }

    // Row selection is intentionally driven only by real cells. Keeping AG Grid's
    // row-wide click selection disabled prevents the empty space after the last
    // column from selecting a row.
    event.api.setFocusedCell(event.rowIndex, event.column);
    if (mouseEvent.shiftKey && rowSelectionAnchorRef.current != null) {
      const anchor = rowSelectionAnchorRef.current;
      const start = Math.min(anchor, event.rowIndex);
      const end = Math.max(anchor, event.rowIndex);
      // Shift replaces the prior row selection; Ctrl/Cmd+Shift extends it instead.
      if (!mouseEvent.ctrlKey && !mouseEvent.metaKey) {
        event.api.deselectAll();
      }
      for (let rowIndex = start; rowIndex <= end; rowIndex += 1) {
        event.api.getDisplayedRowAtIndex(rowIndex)?.setSelected(true, false);
      }
    } else if (mouseEvent.ctrlKey || mouseEvent.metaKey) {
      event.node.setSelected(!event.node.isSelected(), false);
      if (event.node.isSelected()) {
        rowSelectionAnchorRef.current = event.rowIndex;
      }
    } else {
      event.node.setSelected(true, true);
      rowSelectionAnchorRef.current = event.rowIndex;
    }

    const field = event.column.getColDef().field;
    if (typeof field !== "string") {
      // The row-number gutter is not a result cell. It selects the row but must not leave the
      // previously selected data-cell range painted behind it.
      cellSelectionRef.current = null;
      QueryResultGridService.clearCellSelection();
      event.api.refreshCells({ force: true });
      return;
    }
    const columnIndex = result.columns.indexOf(field);
    if (columnIndex < 0) return;

    draggingCellSelectionRef.current = true;
    applyCellSelection(
      event.rowIndex,
      columnIndex,
      event.rowIndex,
      columnIndex,
    );
  };

  const handleCellMouseOver = (event: CellMouseOverEvent<QueryResultRow>) => {
    const selection = cellSelectionRef.current;
    const field = event.column.getColDef().field;
    if (
      !draggingCellSelectionRef.current ||
      !selection ||
      event.rowIndex == null ||
      typeof field !== "string"
    ) {
      return;
    }
    const columnIndex = result.columns.indexOf(field);
    if (columnIndex < 0) return;

    applyCellSelection(
      selection.anchorRowIndex,
      selection.anchorColumnIndex,
      event.rowIndex,
      columnIndex,
    );
  };

  const handleCellContextMenu = (
    event: CellContextMenuEvent<QueryResultRow>,
  ) => {
    if (event.rowIndex == null) return;

    event.api.setFocusedCell(event.rowIndex, event.column);
    event.node.setSelected(true, true);
    rowSelectionAnchorRef.current = event.rowIndex;

    const field = event.column.getColDef().field;
    if (typeof field !== "string") return;
    const columnIndex = result.columns.indexOf(field);
    if (columnIndex < 0) return;

    const selection = cellSelectionRef.current;
    const isInsideSelection = selection
      ? event.rowIndex >=
          Math.min(selection.anchorRowIndex, selection.focusRowIndex) &&
        event.rowIndex <=
          Math.max(selection.anchorRowIndex, selection.focusRowIndex) &&
        columnIndex >=
          Math.min(selection.anchorColumnIndex, selection.focusColumnIndex) &&
        columnIndex <=
          Math.max(selection.anchorColumnIndex, selection.focusColumnIndex)
      : false;
    if (!isInsideSelection) {
      applyCellSelection(
        event.rowIndex,
        columnIndex,
        event.rowIndex,
        columnIndex,
      );
    }
  };

  const handleCellDoubleClicked = (event: CellDoubleClickedEvent<QueryResultRow>) => {
    const field = event.column.getColDef().field;
    if (event.rowIndex == null || typeof field !== "string") return;
    const columnIndex = result.columns.indexOf(field);
    if (columnIndex < 0 || !event.data || !supportsValueEditor(columnIndex, event.data[field] ?? null)) return;
    event.api.stopEditing();
    const rowIndex = getQueryResultRowIndex(event.data);
    setValueEditorTarget({
      rowIndex,
      column: field,
      columnIndex,
      value: event.data[field] ?? null,
      valueIsTruncated: result.lobTruncated?.[rowIndex]?.[columnIndex] === true,
      editorKind: getValueEditorKind(columnIndex, event.data[field] ?? null),
    });
  };

  /** Keep the row highlight and cell selection in sync with keyboard navigation. */
  const navigateToNextCell = (
    params: NavigateToNextCellParams<QueryResultRow>,
  ) => {
    const next = params.nextCellPosition;
    if (next && next.rowPinned == null) {
      const field = next.column.getColDef().field;
      const columnIndex =
        typeof field === "string" ? result.columns.indexOf(field) : -1;
      if (columnIndex >= 0) {
        applyCellSelection(
          next.rowIndex,
          columnIndex,
          next.rowIndex,
          columnIndex,
        );
      }
      if (params.key === "ArrowUp" || params.key === "ArrowDown") {
        params.api.getDisplayedRowAtIndex(next.rowIndex)?.setSelected(true, true);
      }
    }
    return next;
  };

  /** Discards every pending change for this tab without saving — irreversible, so confirm first. */
  const handleCancelChanges = () => {
    if (!QueryResultDirtyService.hasPendingChanges(tabId)) return;
    void ConfirmDialogService.confirm({
      title: t("app.query.cancelChanges"),
      message: t("app.query.cancelChangesConfirm"),
      confirmLabel: t("app.query.cancelChanges"),
      danger: true,
    }).then((confirmed) => {
      if (confirmed) applyCancelChanges();
    });
  };

  /**
   * Restores edited cells to their original values (via `setDataValue`, which re-fires
   * `onCellValueChanged` and lets the normal dirty-clearing logic run), removes added/duplicated
   * rows from the grid, and un-marks rows pending deletion.
   */
  const applyCancelChanges = () => {
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

  const focusedCellForMenu = apiRef.current?.getFocusedCell();
  const focusedFieldForMenu = focusedCellForMenu?.column.getColDef().field;
  const focusedColumnIndexForMenu = typeof focusedFieldForMenu === "string"
    ? result.columns.indexOf(focusedFieldForMenu)
    : -1;
  const focusedRowForMenu = focusedCellForMenu
    ? apiRef.current?.getDisplayedRowAtIndex(focusedCellForMenu.rowIndex)?.data
    : undefined;
  const hasFocusedDataCell = focusedRowForMenu != null && focusedColumnIndexForMenu >= 0;

  const gridContextMenuItems: ContextMenuItem[] = [
    {
      id: "editValue",
      label: t("app.query.editValue"),
      enabled: (() => {
        const focused = apiRef.current?.getFocusedCell();
        const field = focused?.column.getColDef().field;
        if (typeof field !== "string" || !focused) return false;
        const columnIndex = result.columns.indexOf(field);
        const row = apiRef.current?.getDisplayedRowAtIndex(focused.rowIndex)?.data;
        return columnIndex >= 0 && row != null && supportsValueEditor(columnIndex, row[field] ?? null);
      })(),
    },
    { id: "setEmptyValue", label: t("app.query.setEmptyValue"), enabled: hasFocusedDataCell },
    { id: "setNullValue", label: t("app.query.setNullValue"), enabled: hasFocusedDataCell },
    ...(() => {
      const focused = apiRef.current?.getFocusedCell();
      const field = focused?.column.getColDef().field;
      if (typeof field !== "string" || !focused) return [];
      const columnIndex = result.columns.indexOf(field);
      const row = apiRef.current?.getDisplayedRowAtIndex(focused.rowIndex)?.data;
      if (!row || temporalEditorKind(result.columnTypes?.[columnIndex], row[field] ?? null) == null) return [];
      return [{ id: "setCurrentTime", label: t("app.query.setCurrentTime"), enabled: true }];
    })(),
    { id: "copySelection", label: t("app.query.copySelection"), enabled: true, separator: hasFocusedDataCell },
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

  const headerContextMenuItems: ContextMenuItem[] = useMemo(() => {
    if (!contextMenu || contextMenu.kind !== "header") return [];
    const state = apiRef.current
      ?.getColumnState()
      .find((column) => column.colId === contextMenu.columnId);
    const isPinned = state?.pinned === "left";
    return [
      { id: "sortAsc", label: t("app.query.sortAscending"), enabled: true },
      { id: "sortDesc", label: t("app.query.sortDescending"), enabled: true },
      {
        id: "clearSort",
        label: t("app.query.clearSort"),
        enabled: state?.sort != null,
      },
      {
        id: "autoSizeColumn",
        label: t("app.query.autoSizeColumn"),
        enabled: true,
        separator: true,
      },
      {
        id: "autoSizeAllColumns",
        label: t("app.query.autoSizeAllColumns"),
        enabled: true,
      },
      {
        id: isPinned ? "unpinColumn" : "pinColumnLeft",
        label: t(
          isPinned ? "app.query.unpinColumn" : "app.query.pinColumnLeft",
        ),
        enabled: true,
      },
      {
        id: "hideColumn",
        label: t("app.query.hideColumn"),
        enabled: true,
      },
      {
        id: "resetColumnLayout",
        label: t("app.query.resetLayout"),
        enabled: true,
        separator: true,
      },
    ];
  }, [contextMenu, t]);

  const filterContextMenuItems: ContextMenuItem[] = useMemo(() => {
    if (!contextMenu || contextMenu.kind !== "filter") return [];
    const input = filterContextInputRef.current;
    const selectionStart = input?.selectionStart ?? 0;
    const selectionEnd = input?.selectionEnd ?? 0;
    const hasSelection = selectionEnd > selectionStart;
    const hasText = Boolean(input?.value.length);
    const hasFilter = Boolean(apiRef.current?.getFilterModel()[contextMenu.columnId]);
    return [
      {
        id: "cutFilterText",
        label: t("workbench.commands.cut"),
        enabled: hasSelection && !input?.readOnly,
      },
      {
        id: "copyFilterText",
        label: t("workbench.commands.copy"),
        enabled: hasSelection,
      },
      {
        id: "pasteFilterText",
        label: t("workbench.commands.paste"),
        enabled: Boolean(input) && !input?.readOnly,
      },
      {
        id: "selectAllFilterText",
        label: t("workbench.commands.selectAll"),
        enabled: hasText,
      },
      {
        id: "clearColumnFilter",
        label: t("app.query.clearColumnFilter"),
        enabled: hasFilter || hasText,
        separator: true,
      },
      {
        id: "clearFilters",
        label: t("app.query.clearFilters"),
        enabled: snapshot.filterActive || snapshot.sortActive,
      },
    ];
  }, [contextMenu, snapshot.filterActive, snapshot.sortActive, t]);

  function handleGridContextMenuSelect(item: ContextMenuItem) {
    switch (item.id) {
      case "editValue":
        openValueEditor();
        return;
      case "setCurrentTime": {
        const api = apiRef.current;
        const focused = api?.getFocusedCell();
        const field = focused?.column.getColDef().field;
        const node = focused && typeof field === "string"
          ? api?.getDisplayedRowAtIndex(focused.rowIndex)
          : undefined;
        node?.setDataValue(field!, CURRENT_TIMESTAMP_VALUE);
        return;
      }
      case "setEmptyValue":
        setFocusedGridCellValue("");
        return;
      case "setNullValue":
        setFocusedGridCellValue(null);
        return;
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

  function setFocusedGridCellValue(value: string | null) {
    const api = apiRef.current;
    const focused = api?.getFocusedCell();
    const field = focused?.column.getColDef().field;
    if (!api || !focused || typeof field !== "string") return;
    api.getDisplayedRowAtIndex(focused.rowIndex)?.setDataValue(field, value);
  }

  function handleHeaderContextMenuSelect(item: ContextMenuItem) {
    if (!contextMenu || contextMenu.kind !== "header") return;
    const api = apiRef.current;
    if (!api) return;
    const { columnId } = contextMenu;

    switch (item.id) {
      case "sortAsc":
      case "sortDesc":
        api.applyColumnState({
          state: [{ colId: columnId, sort: item.id === "sortAsc" ? "asc" : "desc" }],
          defaultState: { sort: null },
        });
        captureGridUiState();
        return;
      case "clearSort":
        api.applyColumnState({ state: [{ colId: columnId, sort: null }] });
        captureGridUiState();
        return;
      case "autoSizeColumn":
        api.autoSizeColumns([columnId], false);
        return;
      case "autoSizeAllColumns":
        QueryResultGridService.autoSizeAllColumns();
        return;
      case "pinColumnLeft":
        api.applyColumnState({ state: [{ colId: columnId, pinned: "left" }] });
        return;
      case "unpinColumn":
        api.applyColumnState({ state: [{ colId: columnId, pinned: null }] });
        return;
      case "hideColumn":
        api.setColumnsVisible([columnId], false);
        return;
      case "resetColumnLayout":
        handleResetColumnLayout();
        return;
      default:
        return;
    }
  }

  function replaceFilterSelection(input: FilterInput, text: string) {
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    input.focus();
    input.setRangeText(text, start, end, "end");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  async function handleFilterContextMenuSelect(item: ContextMenuItem) {
    if (!contextMenu || contextMenu.kind !== "filter") return;
    const input = filterContextInputRef.current;

    switch (item.id) {
      case "cutFilterText": {
        if (!input) return;
        const start = input.selectionStart ?? 0;
        const end = input.selectionEnd ?? start;
        if (end <= start) return;
        await navigator.clipboard.writeText(input.value.slice(start, end));
        replaceFilterSelection(input, "");
        return;
      }
      case "copyFilterText": {
        if (!input) return;
        const start = input.selectionStart ?? 0;
        const end = input.selectionEnd ?? start;
        if (end > start) {
          await navigator.clipboard.writeText(input.value.slice(start, end));
        }
        return;
      }
      case "pasteFilterText":
        if (!input) return;
        try {
          replaceFilterSelection(input, await navigator.clipboard.readText());
        } catch {
          flashMessage(t("app.query.pasteFailed"));
        }
        return;
      case "selectAllFilterText":
        input?.focus();
        input?.select();
        return;
      case "clearColumnFilter":
        if (apiRef.current) {
          await apiRef.current.setColumnFilterModel(contextMenu.columnId, null);
          apiRef.current.onFilterChanged();
        }
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
      const nextPreview = await buildUpdatePreview(tabId, sql, result.columns, result.columnTypes, {
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
    // `refreshTabResult` replaces row data in the existing grid. Clear both selection models
    // before those row positions can be reused by the refreshed result (for example, after two
    // deleted rows make different rows occupy the same indexes).
    apiRef.current?.deselectAll();
    rowSelectionAnchorRef.current = null;
    cellSelectionRef.current = null;
    QueryResultGridService.clearCellSelection();
    apiRef.current?.refreshCells({ force: true });
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
                useIncrementalScroll
                  ? t("app.query.scrollableTitle")
                  : t("app.query.truncatedTitle").replace(
                      "{n}",
                      maxRows.toLocaleString(),
                    )
              }
            >
              {useIncrementalScroll
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
              t("app.query.addRowTitle")
            }
            aria-label={t("app.query.addRow")}
            onClick={handleAddRow}
          >
            <Codicon name="add" />
          </button>
          <button
            type="button"
            className="query-result-grid__action"
            title={
              t("app.query.duplicateRowTitle")
            }
            aria-label={t("app.query.duplicateRow")}
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
        onKeyDownCapture={(event) => {
          const target = event.target;
          const isEditableTarget =
            target instanceof HTMLInputElement ||
            target instanceof HTMLTextAreaElement ||
            (target instanceof HTMLElement && target.isContentEditable);
          if (
            !isEditableTarget &&
            !event.shiftKey &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey &&
            event.key === "Enter" &&
            shouldOpenTextValueEditorOnEnter()
          ) {
            event.preventDefault();
            event.stopPropagation();
            openValueEditor();
            return;
          }
          if (
            !isEditableTarget &&
            event.shiftKey &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey &&
            event.key === "Enter"
          ) {
            event.preventDefault();
            event.stopPropagation();
            openValueEditor();
            return;
          }
          if (
            !isEditableTarget &&
            (event.ctrlKey || event.metaKey) &&
            !event.altKey &&
            !event.shiftKey &&
            event.key.toLowerCase() === "c"
          ) {
            event.preventDefault();
            event.stopPropagation();
            void handleCopySelection();
          }
        }}
        onContextMenu={(event) => {
          const target = event.target instanceof Element ? event.target : null;
          const filter = target?.closest(".ag-floating-filter");
          if (filter) {
            const columnId = filter.closest(".ag-header-cell")?.getAttribute("col-id");
            if (columnId && result.columns.includes(columnId)) {
              event.preventDefault();
              const input = target?.closest("input, textarea");
              filterContextInputRef.current =
                input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement
                  ? input
                  : null;
              setContextMenu({
                kind: "filter",
                x: event.clientX,
                y: event.clientY,
                columnId,
              });
            }
            return;
          }

          const header = target?.closest(".ag-header-cell");
          const columnId = header?.getAttribute("col-id");
          event.preventDefault();
          if (columnId && result.columns.includes(columnId)) {
            setContextMenu({
              kind: "header",
              x: event.clientX,
              y: event.clientY,
              columnId,
            });
            return;
          }
          setContextMenu({ kind: "data", x: event.clientX, y: event.clientY });
        }}
      >
        <AgGridReact<QueryResultRow>
          key="client"
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
            "query-result-grid__row--dirty": (params) => {
              if (!params.data) return false;
              return QueryResultDirtyService.isRowDirty(
                tabId,
                getQueryResultRowIndex(params.data),
              );
            },
          }}
          rowSelection={{
            mode: "multiRow",
            checkboxes: false,
            headerCheckbox: false,
            enableClickSelection: false,
          }}
          navigateToNextCell={navigateToNextCell}
          onGridReady={handleGridReady}
          onFirstDataRendered={handleFirstDataRendered}
          onBodyScrollEnd={handleBodyScrollEnd}
          onCellContextMenu={handleCellContextMenu}
          onCellDoubleClicked={handleCellDoubleClicked}
          onCellMouseDown={handleCellMouseDown}
          onCellMouseOver={handleCellMouseOver}
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

      {contextMenu ? (
        <ContextMenu
          anchor={{ top: contextMenu.y, left: contextMenu.x }}
          items={
            contextMenu.kind === "header"
              ? headerContextMenuItems
              : contextMenu.kind === "filter"
                ? filterContextMenuItems
              : gridContextMenuItems
          }
          onClose={() => setContextMenu(null)}
          onSelect={
            contextMenu.kind === "header"
              ? handleHeaderContextMenuSelect
              : contextMenu.kind === "filter"
                ? handleFilterContextMenuSelect
              : handleGridContextMenuSelect
          }
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
      {valueEditorTarget ? (
        <QueryResultValueEditorDialog
          column={valueEditorTarget.column}
          columnIndex={valueEditorTarget.columnIndex}
          rowIndex={valueEditorTarget.rowIndex}
          value={valueEditorTarget.value}
          valueIsTruncated={valueEditorTarget.valueIsTruncated}
          editorKind={valueEditorTarget.editorKind}
          result={result}
          sql={executedSql ?? sql}
          binds={binds}
          connectionId={connectionId}
          onCancel={() => setValueEditorTarget(null)}
          onSave={(value) => {
            const node = apiRef.current?.getRowNode(String(valueEditorTarget.rowIndex));
            node?.setDataValue(valueEditorTarget.column, normalizeEditedValue(value, valueEditorTarget.columnIndex));
            setValueEditorTarget(null);
          }}
        />
      ) : null}
    </div>
  );
}

function temporalEditorKind(
  columnType: NonNullable<QueryResultPayload["columnTypes"]>[number] | undefined,
  value: string | null,
): "date" | "time" | "datetime" | null {
  if (!columnType) return null;
  const typeName = columnType.typeName.toUpperCase();
  // Native date/time inputs have no lossless representation for an offset/zone. Keep those as
  // ordinary text until a dedicated time-zone editor is added rather than silently dropping it.
  if (columnType.jdbcType === 2013 || columnType.jdbcType === 2014 || /WITH\s+TIME\s+ZONE/.test(typeName)) {
    return null;
  }
  const hasDate = /DATE|DATETIME|TIMESTAMP/.test(typeName) || columnType.jdbcType === DATE_JDBC_TYPE || TIMESTAMP_JDBC_TYPES.has(columnType.jdbcType);
  const hasTime = /TIME|DATETIME|TIMESTAMP/.test(typeName) || columnType.jdbcType === TIME_JDBC_TYPE || TIMESTAMP_JDBC_TYPES.has(columnType.jdbcType);
  if (hasDate && hasTime) return "datetime";
  if (hasDate) return value && /\d{2}:\d{2}/.test(value) ? "datetime" : "date";
  if (hasTime) return "time";
  return null;
}

/** Converts native-input and ordinary Enter edits to the exact representation shown in the grid. */
function normalizeTemporalValue(
  value: string,
  columnType: NonNullable<QueryResultPayload["columnTypes"]>[number] | undefined,
): string {
  // This is a semantic grid value, not ISO text. In particular, do not turn the `T` in the
  // sentinel into a space before `safeUpdateSql` can translate it to the database's NOW syntax.
  if (isCurrentTimestampValue(value)) return value;
  const kind = temporalEditorKind(columnType, value);
  if (!kind) return value;
  const normalized = value.trim().replace("T", " ");
  if (kind === "date") {
    return normalized.match(/^\d{4}-\d{2}-\d{2}$/) ? normalized : value;
  }
  if (kind === "time") {
    return normalized.match(/^\d{2}:\d{2}$/) ? `${normalized}:00` : normalized;
  }
  if (normalized.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)) {
    return `${normalized}:00`;
  }
  return normalized;
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
