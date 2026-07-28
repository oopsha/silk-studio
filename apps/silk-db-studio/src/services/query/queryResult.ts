export type {
  QueryResultKind,
  QueryResultPayload,
} from "@silk-studio/db-protocol";

export type QueryResultRow = Record<string, string | null>;

export function toQueryResultRows(
  columns: string[],
  rows: Array<Array<string | null>>,
): QueryResultRow[] {
  return rows.map((cells) => {
    const row: QueryResultRow = {};
    columns.forEach((column, index) => {
      row[column] = cells[index] ?? null;
    });
    return row;
  });
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
