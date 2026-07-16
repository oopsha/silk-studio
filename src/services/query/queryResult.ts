export type QueryResultKind = "resultSet" | "update";

export type QueryResultPayload = {
  kind: QueryResultKind;
  columns: string[];
  rows: Array<Array<string | null>>;
  rowCount: number;
  updateCount: number | null;
  message: string;
};

export type QueryResultRow = Record<string, string | null>;

export function isQueryResultPayload(value: unknown): value is QueryResultPayload {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    (record.kind === "resultSet" || record.kind === "update") &&
    Array.isArray(record.columns) &&
    Array.isArray(record.rows) &&
    typeof record.rowCount === "number" &&
    typeof record.message === "string"
  );
}

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
