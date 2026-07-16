export type AgentMethod =
  | "agent.ping"
  | "agent.shutdown"
  | "connection.open"
  | "query.execute";

export type AgentRequest<TParams = unknown> = {
  id: number;
  method: AgentMethod;
  params: TParams;
};

export type AgentError = {
  message: string;
  sqlState?: string | null;
  errorCode?: number;
};

export type AgentResponse<TResult = unknown> = {
  id: number | null;
  ok: boolean;
  result?: TResult;
  error?: AgentError;
};

export type QueryResultKind = "resultSet" | "update";

export type QueryResultPayload = {
  kind: QueryResultKind;
  columns: string[];
  rows: Array<Array<string | null>>;
  rowCount: number;
  updateCount: number | null;
  message: string;
};

export function isQueryResultPayload(
  value: unknown,
): value is QueryResultPayload {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    (record.kind === "resultSet" || record.kind === "update") &&
    Array.isArray(record.columns) &&
    record.columns.every((column) => typeof column === "string") &&
    Array.isArray(record.rows) &&
    record.rows.every(
      (row) =>
        Array.isArray(row) &&
        row.every((cell) => cell === null || typeof cell === "string"),
    ) &&
    typeof record.rowCount === "number" &&
    (record.updateCount === null || typeof record.updateCount === "number") &&
    typeof record.message === "string"
  );
}
