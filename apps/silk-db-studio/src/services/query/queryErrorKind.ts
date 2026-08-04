import { formatErrorMessage } from "../formatErrorMessage";

export type QueryErrorKind = "cancel" | "timeout" | "other";

/**
 * Classify JDBC / bridge failures so timeouts are not shown as user cancels.
 * SQL Server often says "statement has been canceled" for query timeouts.
 */
export function classifyQueryError(error: unknown): QueryErrorKind {
  const message = formatErrorMessage(error, "").toLowerCase();
  if (!message) return "other";

  // Timeout first — messages frequently contain both "cancel" and "timeout".
  if (isTimeoutMessage(message)) {
    return "timeout";
  }

  if (isUserCancelMessage(message)) {
    return "cancel";
  }

  return "other";
}

export function isCancelError(error: unknown): boolean {
  return classifyQueryError(error) === "cancel";
}

export function isTimeoutError(error: unknown): boolean {
  return classifyQueryError(error) === "timeout";
}

function isTimeoutMessage(message: string): boolean {
  return (
    message.includes("timed out") ||
    message.includes("time out") ||
    message.includes("time-out") ||
    message.includes("timeout")
  );
}

function isUserCancelMessage(message: string): boolean {
  // Do NOT match bare "cancel" — object names like CANCEL_YN appear in SQL errors.
  return (
    message.includes("ora-01013") ||
    message.includes("cancelled by user") ||
    message.includes("canceled by user") ||
    message.includes("query was cancelled") ||
    message.includes("query was canceled") ||
    message.includes("query cancelled") ||
    message.includes("query canceled") ||
    message.includes("the query has been cancelled") ||
    message.includes("the query has been canceled") ||
    message.includes("statement cancelled by") ||
    message.includes("statement canceled by") ||
    message.includes("operation cancelled") ||
    message.includes("operation canceled")
  );
}

/** Script batches get at least this many seconds unless the user chose unlimited (0). */
export const SCRIPT_QUERY_TIMEOUT_FLOOR_SEC = 300;

/**
 * Per-batch timeout for Execute Script.
 * - Settings `0` → unlimited (JDBC setQueryTimeout(0))
 * - Otherwise → max(configured, 300s) so large scripts are less likely to abort mid-run
 */
export function resolveScriptQueryTimeoutSec(configuredSec: number): number {
  if (configuredSec <= 0) return 0;
  return Math.max(configuredSec, SCRIPT_QUERY_TIMEOUT_FLOOR_SEC);
}
