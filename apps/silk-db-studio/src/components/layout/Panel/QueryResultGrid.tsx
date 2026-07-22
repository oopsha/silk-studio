import { useMemo } from "react";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type ValueFormatterParams,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useConfiguration } from "@silk-studio/workbench/platform/configuration/useConfiguration.ts";
import type { ColorThemeId } from "@silk-studio/workbench/platform/configuration/configurationDefaults.ts";
import {
  toQueryResultRows,
  type QueryResultPayload,
  type QueryResultRow,
} from "../../../services/query/queryResult";
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
        field: column,
        headerName: column,
        filter: filterEnabled ? "agTextColumnFilter" : false,
        editable: true,
        sortable: true,
        resizable: true,
        flex: 1,
        minWidth: 120,
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
      filter: filterEnabled,
      editable: true,
      sortable: true,
      resizable: true,
    }),
    [filterEnabled],
  );

  return (
    <div className="query-result-grid">
      <AgGridReact<QueryResultRow>
        theme={gridTheme}
        columnDefs={columnDefs}
        rowData={rowData}
        defaultColDef={defaultColDef}
        rowHeight={rowHeight}
        animateRows={false}
        stopEditingWhenCellsLoseFocus
      />
    </div>
  );
}

export default QueryResultGrid;
