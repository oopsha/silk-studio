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
