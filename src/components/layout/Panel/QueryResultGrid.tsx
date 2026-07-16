import { useMemo } from "react";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type ValueFormatterParams,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import {
  toQueryResultRows,
  type QueryResultPayload,
  type QueryResultRow,
} from "../../../services/query/queryResult";
import "./QueryResultGrid.css";

ModuleRegistry.registerModules([AllCommunityModule]);

const gridTheme = themeQuartz.withParams({
  backgroundColor: "#191a1b",
  dataBackgroundColor: "#191a1b",
  foregroundColor: "#bfbfbf",
  borderColor: "#2a2b2c",
  // Header block slightly elevated vs body; separator drawn in CSS under whole header
  headerBackgroundColor: "#202122",
  headerTextColor: "#bfbfbf",
  headerFontWeight: 600,
  headerRowBorder: false,
  headerColumnBorder: false,
  // Zebra: even = panel (#191a1b), odd = list.hover, hover = editor.lineHighlight
  oddRowBackgroundColor: "#1e1f20",
  rowBorder: false,
  rowHoverColor: "#242526",
  selectedRowBackgroundColor: "rgba(57, 148, 188, 0.22)",
  inputBackgroundColor: "#121314",
  inputTextColor: "#bfbfbf",
  inputBorder: { color: "#333536" },
  fontFamily: "inherit",
  fontSize: 12,
  headerFontSize: 12,
  cellHorizontalPadding: 8,
  rowHeight: 26,
  headerHeight: 28,
});

type QueryResultGridProps = {
  result: QueryResultPayload;
};

function formatCellValue(params: ValueFormatterParams<QueryResultRow>): string {
  if (params.value === null || params.value === undefined) {
    return "NULL";
  }
  return String(params.value);
}

function QueryResultGrid({ result }: QueryResultGridProps) {
  const columnDefs = useMemo<ColDef<QueryResultRow>[]>(
    () =>
      result.columns.map((column) => ({
        field: column,
        headerName: column,
        filter: "agTextColumnFilter",
        editable: true,
        sortable: true,
        resizable: true,
        flex: 1,
        minWidth: 120,
        valueFormatter: formatCellValue,
      })),
    [result.columns],
  );

  const rowData = useMemo(
    () => toQueryResultRows(result.columns, result.rows),
    [result.columns, result.rows],
  );

  const defaultColDef = useMemo<ColDef>(
    () => ({
      filter: true,
      editable: true,
      sortable: true,
      resizable: true,
    }),
    [],
  );

  return (
    <div className="query-result-grid">
      <AgGridReact<QueryResultRow>
        theme={gridTheme}
        columnDefs={columnDefs}
        rowData={rowData}
        defaultColDef={defaultColDef}
        animateRows={false}
        stopEditingWhenCellsLoseFocus
      />
    </div>
  );
}

export default QueryResultGrid;
