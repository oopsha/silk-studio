import type { QueryResultPayload } from "@silk-studio/db-protocol";

/** Soft cap — oldest tabs are dropped when exceeded. */
export const MAX_QUERY_RESULT_TABS = 10;

export type QueryResultTabStatus = "success" | "error" | "cancelled";

export type QueryResultTab = {
  id: string;
  /** Short label shown on the tab strip (e.g. Result 3). */
  title: string;
  sql: string;
  status: QueryResultTabStatus;
  output: string;
  result: QueryResultPayload | null;
  createdAt: number;
  /** When opened from the explorer, marks table vs view for save eligibility. */
  relationKind?: "table" | "view";
};

export function buildQueryResultTabTitle(
  sql: string,
  result: QueryResultPayload | null,
  ordinal: number,
): string {
  const trimmed = sql.trim();
  if (/^\s*explain\b/i.test(trimmed) || /\bDBMS_XPLAN\b/i.test(trimmed)) {
    return `Explain ${ordinal}`;
  }
  if (result?.kind === "update") {
    return `Update ${ordinal}`;
  }
  if (result?.kind === "resultSet") {
    return `Result ${ordinal}`;
  }
  // Message-only success (e.g. desktop mock / plan text without grid).
  if (/^\s*explain\b/i.test(trimmed)) {
    return `Explain ${ordinal}`;
  }
  return `Result ${ordinal}`;
}

export function truncateSqlLabel(sql: string, max = 120): string {
  const oneLine = sql.trim().replace(/\s+/g, " ");
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max - 1)}…`;
}
