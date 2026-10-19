import { invoke } from "@tauri-apps/api/core";
import type { MetadataColumn } from "@silk-studio/db-protocol";
import { ConfigurationService } from "@silk-studio/workbench/platform/configuration/configurationService.ts";
import { AppLogService } from "@silk-studio/workbench/services/diagnostics/appLogService.ts";
import { ConnectionTransactionService } from "../connection/connectionTransactionService";
import { formatTableReference, quoteIdentifier } from "./sqlLiteral";
import { importCell, type FileImportPlan } from "./fileImportPlan";
import type { ParsedImportSource } from "./queryResultImport";
import type { UpdateEligibility } from "./queryResultUpdateService";

export type ImportTarget = Extract<UpdateEligibility, { eligible: true }> & { connectionId: string; columns: MetadataColumn[] };
export type ImportProgress = { completed: number; total: number; phase: "preparing" | "validating" | "inserting" | "finishing" | "done" | "waiting" };

function importErrorForLog(error: unknown): string {
  const name = error instanceof Error ? error.name : typeof error;
  const message = error instanceof Error ? error.message : String(error);
  // SQL Server may include an excerpt of the rejected cell value in truncation errors.
  const safeMessage = message.replace(/Truncated value:\s*'[^']*'/gi, "Truncated value: '[redacted]'");
  return `${name}: ${safeMessage}`.slice(0, 2000);
}

export function parseImportFile(file: File): Promise<ParsedImportSource> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./importFile.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<{ source?: ParsedImportSource; error?: string }>) => {
      worker.terminate();
      if (event.data.source) resolve(event.data.source);
      else reject(new Error(event.data.error ?? "Could not read file."));
    };
    worker.onerror = (event) => { worker.terminate(); reject(new Error(event.message)); };
    worker.postMessage(file);
  });
}

/** Sends values, not generated SQL per row. The agent owns transaction and JDBC batch execution. */
export async function executeFileImport(
  target: ImportTarget,
  plan: FileImportPlan,
  signal: AbortSignal,
  onProgress: (progress: ImportProgress) => void,
): Promise<{ completed: number; pendingCommit: boolean }> {
  if (ConfigurationService.getValue("database.readOnly")) throw new Error("Read-only mode is enabled.");
  const operationId = crypto.randomUUID();
  const startedAt = Date.now();
  const table = formatTableReference(target.schema, target.table, target.driverId, target.catalog);
  let lastLoggedPhase = "";
  const reportProgress = (progress: ImportProgress) => {
    onProgress(progress);
    if (progress.phase !== "waiting" && progress.phase !== lastLoggedPhase) {
      lastLoggedPhase = progress.phase;
      void AppLogService.info(
        `File import progress. operationId=${operationId} table=${table} phase=${progress.phase} rows=${progress.completed}/${progress.total}`,
        "query.import",
      );
    }
  };
  void AppLogService.info(
    `File import started. operationId=${operationId} table=${table} rows=${plan.rows.length} columns=${plan.columns.length} clearExisting=${plan.clearExisting}`,
    "query.import",
  );
  const rows: Array<Array<string | null>> = [];
  for (let start = 0; start < plan.rows.length; start += 500) {
    if (signal.aborted) {
      void AppLogService.warn(`File import cancelled during preparation. operationId=${operationId} table=${table} preparedRows=${rows.length}/${plan.rows.length}`, "query.import");
      throw new DOMException("Import cancelled", "AbortError");
    }
    const end = Math.min(start + 500, plan.rows.length);
    for (let index = start; index < end; index++) {
      rows.push(plan.columns.map((column) => importCell(plan.rows[index][column.sourceIndex], column.empty)));
    }
    reportProgress({ phase: "preparing", completed: end, total: plan.rows.length });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  if (signal.aborted) {
    void AppLogService.warn(`File import cancelled before database request. operationId=${operationId} table=${table} preparedRows=${rows.length}/${plan.rows.length}`, "query.import");
    throw new DOMException("Import cancelled", "AbortError");
  }
  let finished = false;
  let polling: Promise<void> | undefined;
  const poll = () => {
    if (finished || polling) return;
    polling = invoke<ImportProgress>("query_import_status", {
      connectionId: target.connectionId, operationId, cancel: signal.aborted,
    }).then((progress) => {
      if (!finished && progress.phase !== "waiting") reportProgress(progress);
    }).catch(() => { /* The import request reports transport errors. */ }).finally(() => { polling = undefined; });
  };
  const timer = setInterval(poll, 250);
  signal.addEventListener("abort", poll);
  reportProgress({ phase: "validating", completed: 0, total: rows.length });
  try {
    // Do not replay writes on a lost connection. Only metadata lookup may transparently reconnect.
    return await invoke<{ completed: number; pendingCommit: boolean }>("query_import_rows", {
      connectionId: target.connectionId,
      params: {
        operationId,
        tableSql: table,
        columns: plan.columns.map((column) => column.name),
        columnSql: plan.columns.map((column) => quoteIdentifier(column.name, target.driverId)).join(","),
        rows,
        clearExisting: plan.clearExisting,
        firstFileRow: plan.firstFileRow,
        queryTimeoutSec: ConfigurationService.getValue("database.queryTimeoutSec"),
        autoCommit: ConfigurationService.getValue("database.autoCommit"),
        readOnly: ConfigurationService.getValue("database.readOnly"),
      },
    }).then((result) => {
      if (result.pendingCommit) ConnectionTransactionService.markDirty(target.connectionId);
      void AppLogService.info(
        `File import completed. operationId=${operationId} table=${table} insertedRows=${result.completed} pendingCommit=${result.pendingCommit} elapsedMs=${Date.now() - startedAt}`,
        "query.import",
      );
      return result;
    });
  } catch (error) {
    if (signal.aborted) {
      void AppLogService.warn(
        `File import cancelled. operationId=${operationId} table=${table} elapsedMs=${Date.now() - startedAt} detail=${importErrorForLog(error)}`,
        "query.import",
      );
    } else {
      void AppLogService.error(
        `File import failed. operationId=${operationId} table=${table} rows=${rows.length} columns=${plan.columns.length} clearExisting=${plan.clearExisting} elapsedMs=${Date.now() - startedAt} detail=${importErrorForLog(error)}`,
        "query.import",
      );
    }
    throw error;
  } finally {
    finished = true;
    clearInterval(timer);
    signal.removeEventListener("abort", poll);
  }
}
