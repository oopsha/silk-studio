import { invoke } from "@tauri-apps/api/core";
import { ConfigurationService } from "@silk-studio/workbench/platform/configuration/configurationService.ts";
import { invokeJdbcCommand } from "../connection/jdbcInvoke";
import type { FilterColumnWire, SortColumnWire } from "./filterModelTranslator";

export type StreamCsvRequest = {
  connectionId: string;
  /** The exact executed statement (bind placeholders already rewritten to `?`). */
  sql: string;
  knownColumns: string[];
  /** Visible columns in grid order. */
  columns: string[];
  path: string;
  format?: "csv" | "xlsx";
  binds?: Array<string | null>;
  filters?: FilterColumnWire[];
  sort?: SortColumnWire[];
  signal?: AbortSignal;
  onProgress?: (rowCount: number) => void;
};

export type StreamCsvResult = { rowCount: number; cancelled: boolean };

const PROGRESS_POLL_MS = 250;

/**
 * Streams the full query result into `path` inside the jdbc-agent: the statement runs once and
 * rows are written from a single cursor, instead of re-running it for every OFFSET page.
 * Progress and cancellation use the agent's operation status channel.
 */
export async function streamQueryResultCsv(request: StreamCsvRequest): Promise<StreamCsvResult> {
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
      .catch(() => { /* The export request itself reports transport errors. */ })
      .finally(() => { polling = false; });
  };
  const timer = setInterval(poll, PROGRESS_POLL_MS);
  signal?.addEventListener("abort", poll);
  try {
    return await invokeJdbcCommand<StreamCsvResult>(
      "query_export_result",
      {
        connectionId,
        params: {
          operationId,
          path: request.path,
          format: request.format ?? "csv",
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
