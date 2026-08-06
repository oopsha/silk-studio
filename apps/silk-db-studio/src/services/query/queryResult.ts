export type {
  QueryResultKind,
  QueryResultPayload,
} from "@silk-studio/db-protocol";

/** Internal row key — not part of result columns. */
export const QUERY_RESULT_ROW_INDEX_KEY = "__rowIndex";

/** Grid-only row number column (display index, not a result field). */
export const QUERY_RESULT_ROW_NUMBER_COL_ID = "__rowNum";

export type QueryResultRow = Record<string, string | null>;

export function toQueryResultRows(
  columns: string[],
  rows: Array<Array<string | null>>,
): QueryResultRow[] {
  return rows.map((cells, rowIndex) => {
    const row: QueryResultRow = {
      [QUERY_RESULT_ROW_INDEX_KEY]: String(rowIndex),
    };
    columns.forEach((column, index) => {
      row[column] = cells[index] ?? null;
    });
    return row;
  });
}

export function getQueryResultRowIndex(row: QueryResultRow): number {
  const raw = row[QUERY_RESULT_ROW_INDEX_KEY];
  if (raw == null) return 0;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Whether the result was cut off at maxRows.
 * Prefer agent `truncated`; fall back to rowCount === maxRows for older agents.
 */
export function isResultTruncated(
  result: { kind: string; rowCount: number; truncated?: boolean },
  maxRows: number,
): boolean {
  if (result.kind !== "resultSet") return false;
  if (typeof result.truncated === "boolean") return result.truncated;
  return maxRows > 0 && result.rowCount >= maxRows;
}
