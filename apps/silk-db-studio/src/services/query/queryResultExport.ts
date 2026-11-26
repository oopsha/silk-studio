import { invoke } from "@tauri-apps/api/core";
import { ConfigurationService } from "@silk-studio/workbench/platform/configuration/configurationService.ts";
import { invokeJdbcCommand } from "../connection/jdbcInvoke";
import type { FilterColumnWire, SortColumnWire } from "./filterModelTranslator";

type StreamResultRequest = {
  connectionId: string;
  /** The exact executed statement (bind placeholders already rewritten to `?`). */
  sql: string;
  knownColumns: string[];
  /** Visible columns in grid order. */
  columns: string[];
  binds?: Array<string | null>;
  filters?: FilterColumnWire[];
  sort?: SortColumnWire[];
  signal?: AbortSignal;
  onProgress?: (rowCount: number) => void;
};

export type StreamCsvRequest = StreamResultRequest & {
  path: string;
  format?: "csv" | "xlsx";
};

export type StreamCsvResult = { rowCount: number; cancelled: boolean };

export type CopyAllRequest = StreamResultRequest & {
  nullDisplay: string;
  maxRows: number;
  maxChars: number;
};

export type CopyAllResult = {
  rowCount: number;
  cancelled: boolean;
  /** The result is larger than `maxRows`/`maxChars`; `text` is empty. */
  limitExceeded?: boolean;
  text: string;
};

const PROGRESS_POLL_MS = 250;

/**
 * Runs one streaming agent operation while polling its progress; aborting `signal` asks the
 * agent to cancel the running statement.
 */
async function runStreamingOperation<T>(
  command: string,
  request: StreamResultRequest,
  extra: Record<string, unknown>,
): Promise<T> {
  const operationId = crypto.randomUUID();
  const { connectionId, signal } = request;
  let finished = false;
  let polling = false;

  const poll = () => {
    if (finished || polling) return;
    polling = true;
    invoke<{ completed: number; phase: string }>("query_import_status", {
      connectionId,
      operationId,
      cancel: signal?.aborted ?? false,
    })
      .then((progress) => {
        if (!finished && progress.phase !== "waiting") request.onProgress?.(progress.completed);
      })
      .catch(() => { /* The operation request itself reports transport errors. */ })
      .finally(() => { polling = false; });
  };
  const timer = setInterval(poll, PROGRESS_POLL_MS);
  signal?.addEventListener("abort", poll);
  try {
    return await invokeJdbcCommand<T>(
      command,
      {
        connectionId,
        params: {
          ...extra,
          operationId,
          sql: request.sql,
          knownColumns: request.knownColumns,
          columns: request.columns,
          binds: request.binds && request.binds.length > 0 ? request.binds : null,
          filters: request.filters && request.filters.length > 0 ? request.filters : null,
          sort: request.sort && request.sort.length > 0 ? request.sort : null,
          queryTimeoutSec: ConfigurationService.getValue("database.queryTimeoutSec"),
          autoCommit: ConfigurationService.getValue("database.autoCommit"),
          readOnly: ConfigurationService.getValue("database.readOnly"),
        },
      },
      connectionId,
    );
  } finally {
    finished = true;
    clearInterval(timer);
    signal?.removeEventListener("abort", poll);
  }
}

/**
 * Streams the full query result into `path` inside the jdbc-agent: the statement runs once and
 * rows are written from a single cursor, instead of re-running it for every OFFSET page.
 * Progress and cancellation use the agent's operation status channel.
 */
export function streamQueryResultCsv(request: StreamCsvRequest): Promise<StreamCsvResult> {
  return runStreamingOperation<StreamCsvResult>("query_export_result", request, {
    path: request.path,
    format: request.format ?? "csv",
  });
}

export type CountRowsRequest = Omit<StreamResultRequest, "columns" | "sort" | "onProgress">;

/**
 * `SELECT COUNT(*) FROM (sql) sq [WHERE filter]` in the agent. Aborting `signal` cancels the
 * statement (it shares the connection's single executor with scroll paging).
 */
export function countQueryResultRows(
  request: CountRowsRequest,
): Promise<{ rowCount?: number; cancelled: boolean }> {
  return runStreamingOperation("query_count_rows", { ...request, columns: [] }, {});
}

/**
 * Fetches the full result (including rows not yet loaded into the grid) as clipboard TSV
 * through the same single-cursor stream. Stops early with `limitExceeded` past the caps.
 */
export function copyQueryResultAll(request: CopyAllRequest): Promise<CopyAllResult> {
  return runStreamingOperation<CopyAllResult>("query_copy_result", request, {
    nullDisplay: request.nullDisplay,
    maxRows: request.maxRows,
    maxChars: request.maxChars,
  });
}
