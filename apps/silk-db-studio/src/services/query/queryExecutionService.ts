import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  isQueryResultPayload,
  type QueryResultPayload,
} from "@silk-studio/db-protocol";
import { ConfigurationService } from "@silk-studio/workbench/platform/configuration/configurationService.ts";
import { formatErrorMessage } from "../formatErrorMessage";
import { ConnectionService } from "../connection/connectionService";
import { resolveActiveDriverId } from "../sql/sqlDialect";
import { QueryHistoryService } from "./queryHistoryService";
import type { QueryHistoryStatus } from "./queryHistoryTypes";
import {
  applySqlErrorMarkers,
  clearSqlErrorMarkers,
  type SqlSourceRange,
} from "./sqlErrorMarkers";
import { buildExplainPlan } from "./sqlExplain";
import { assertReadOnlyQueryAllowed } from "./sqlGuard";
import { stripTrailingSemicolon } from "./sqlExecutable";

export type QueryExecutionStatus =
  | "idle"
  | "running"
  | "success"
  | "error"
  | "cancelled";

export type QueryExecutionState = {
  status: QueryExecutionStatus;
  output: string;
  result: QueryResultPayload | null;
  lastSql: string;
};

export type QueryExecuteOptions = {
  /** Buffer range of the executed SQL for Monaco error markers. */
  sourceRange?: SqlSourceRange;
  /** Override SQL stored in history (e.g. original statement for Explain). */
  historySql?: string;
  skipHistory?: boolean;
};

type QueryExecutionListener = () => void;

const INITIAL_STATE: QueryExecutionState = {
  status: "idle",
  output: "Run a SQL statement to see results.",
  result: null,
  lastSql: "",
};

class QueryExecutionServiceImpl {
  private state: QueryExecutionState = INITIAL_STATE;
  private readonly listeners = new Set<QueryExecutionListener>();
  /** Monotonic token so a late response after cancel/re-run is ignored. */
  private runGeneration = 0;
  private cancelRequested = false;

  getState(): QueryExecutionState {
    return this.state;
  }

  isRunning(): boolean {
    return this.state.status === "running";
  }

  async execute(sql: string, options?: QueryExecuteOptions): Promise<void> {
    const statement = stripTrailingSemicolon(sql.trim());
    if (!statement) {
      this.setState({
        status: "error",
        output: "Query is empty. Write SQL in the editor and run again.",
        result: null,
        lastSql: sql,
      });
      return;
    }

    const generation = ++this.runGeneration;
    this.cancelRequested = false;
    const startedAt = performance.now();
    clearSqlErrorMarkers();

    this.setState({
      status: "running",
      output: "Executing query...",
      result: null,
      lastSql: statement,
    });

    try {
      if (!isTauri()) {
        if (!this.isCurrentRun(generation)) return;
        const output = `Desktop-only JDBC execution.\n\nSQL:\n${statement}`;
        this.setState({
          status: "success",
          output,
          result: null,
          lastSql: statement,
        });
        this.recordHistory(
          options?.historySql ?? statement,
          "success",
          startedAt,
          output,
          options,
        );
        return;
      }

      const readOnly = ConfigurationService.getValue("database.readOnly");
      assertReadOnlyQueryAllowed(statement, readOnly);

      await this.ensureConnected();

      const payload = await this.invokeQuery(statement, readOnly);

      if (!this.isCurrentRun(generation)) {
        return;
      }

      if (this.cancelRequested) {
        this.finishCancelled(statement, startedAt, options);
        return;
      }

      if (!isQueryResultPayload(payload)) {
        throw new Error("Invalid query result payload from desktop bridge.");
      }

      this.setState({
        status: "success",
        output: payload.message,
        result: payload,
        lastSql: statement,
      });
      this.recordHistory(
        options?.historySql ?? statement,
        "success",
        startedAt,
        payload.message,
        options,
      );
    } catch (error) {
      this.handleRunError(error, statement, generation, startedAt, options);
    }
  }

  /**
   * Runs a driver-specific Explain / Explain Plan for the given statement and
   * shows the plan result in the panel (same result grid as normal execute).
   */
  async explain(sql: string, options?: QueryExecuteOptions): Promise<void> {
    const statement = stripTrailingSemicolon(sql.trim());
    if (!statement) {
      this.setState({
        status: "error",
        output: "Query is empty. Write SQL in the editor and explain again.",
        result: null,
        lastSql: sql,
      });
      return;
    }

    const driverId = resolveActiveDriverId();
    const plan = buildExplainPlan(driverId, statement);
    if (plan.steps.length === 0) {
      this.setState({
        status: "error",
        output: "Nothing to explain.",
        result: null,
        lastSql: statement,
      });
      return;
    }

    const generation = ++this.runGeneration;
    this.cancelRequested = false;
    const startedAt = performance.now();
    clearSqlErrorMarkers();

    const historySql = options?.historySql ?? `${plan.label}\n${statement}`;
    const displaySql =
      plan.steps.find((step) => step.captureResult)?.sql ?? statement;

    this.setState({
      status: "running",
      output: `Running ${plan.label}...`,
      result: null,
      lastSql: displaySql,
    });

    const teardownSql =
      plan.steps.find((step) => step.kind === "teardown")?.sql ?? null;
    let captured: QueryResultPayload | null = null;
    let capturedMessage = "";
    /** SQL Server SHOWPLAN was turned on — must restore even on failure. */
    let showplanArmed = false;

    try {
      if (!isTauri()) {
        if (!this.isCurrentRun(generation)) return;
        const preview = plan.steps
          .filter((step) => step.kind !== "teardown")
          .map((step) => step.sql)
          .join("\n\n");
        const output = `Desktop-only JDBC explain.\n\n${plan.label} steps:\n${preview}`;
        this.setState({
          status: "success",
          output,
          result: null,
          lastSql: displaySql,
        });
        this.recordHistory(
          historySql,
          "success",
          startedAt,
          output,
          options,
        );
        return;
      }

      await this.ensureConnected();

      for (const step of plan.steps) {
        if (step.kind === "teardown") {
          continue;
        }

        if (this.cancelRequested || !this.isCurrentRun(generation)) {
          break;
        }

        // Explain does not execute DML (SHOWPLAN / EXPLAIN PLAN). Always talk to the
        // agent with readOnly=false so Oracle can write PLAN_TABLE and SQL Server can
        // accept subject DML under SHOWPLAN. Frontend still blocks accidental writes
        // for normal execute via assertReadOnlyQueryAllowed.
        const payload = await this.invokeQuery(step.sql, false);

        if (step.kind === "setup" && driverId === "sqlserver") {
          showplanArmed = true;
        }

        if (!this.isCurrentRun(generation)) {
          return;
        }

        if (this.cancelRequested) {
          this.finishCancelled(displaySql, startedAt, {
            ...options,
            historySql,
          });
          return;
        }

        if (!isQueryResultPayload(payload)) {
          throw new Error("Invalid query result payload from desktop bridge.");
        }

        if (step.captureResult) {
          captured = payload;
          capturedMessage = payload.message;
        }
      }

      if (!this.isCurrentRun(generation)) {
        return;
      }

      if (this.cancelRequested) {
        this.finishCancelled(displaySql, startedAt, {
          ...options,
          historySql,
        });
        return;
      }

      if (!captured) {
        throw new Error("Explain completed without a plan result.");
      }

      this.setState({
        status: "success",
        output: capturedMessage || `${plan.label} completed.`,
        result: captured,
        lastSql: displaySql,
      });
      this.recordHistory(
        historySql,
        "success",
        startedAt,
        capturedMessage || `${plan.label} completed.`,
        options,
      );
    } catch (error) {
      this.handleRunError(error, displaySql, generation, startedAt, {
        ...options,
        historySql,
      });
    } finally {
      if (showplanArmed && teardownSql && isTauri()) {
        try {
          await this.invokeQuery(teardownSql, false);
        } catch (teardownError) {
          console.warn(
            "[silk.query.explain] failed to restore SHOWPLAN session state",
            teardownError,
          );
        }
      }
    }
  }

  async cancel(): Promise<void> {
    if (this.state.status !== "running") {
      return;
    }

    this.cancelRequested = true;
    this.setState({
      ...this.state,
      output: "Cancelling query...",
    });

    if (!isTauri()) {
      this.runGeneration += 1;
      this.setState({
        status: "cancelled",
        output: "Query cancelled.",
        result: null,
        lastSql: this.state.lastSql,
      });
      return;
    }

    try {
      await invoke("query_cancel");
    } catch (error) {
      // Cancel RPC failed — still mark cancelled when the execute promise settles.
      console.warn("[silk.query.cancel] bridge cancel failed", error);
    }
  }

  onDidChange(listener: QueryExecutionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async ensureConnected(): Promise<void> {
    if (!ConnectionService.isConnected()) {
      const activeProfile = ConnectionService.getActiveProfile();
      if (activeProfile) {
        await ConnectionService.connect(activeProfile.id, { silent: true });
      }
    }

    if (!ConnectionService.isConnected()) {
      throw new Error(
        "No active database connection. Connect a profile in the Connections explorer.",
      );
    }
  }

  private async invokeQuery(
    sql: string,
    readOnly: boolean,
  ): Promise<unknown> {
    const maxRows = ConfigurationService.getValue("queryResult.maxRows");
    const queryTimeoutSec = ConfigurationService.getValue(
      "database.queryTimeoutSec",
    );
    const autoCommit = ConfigurationService.getValue("database.autoCommit");
    return invoke<unknown>("query_execute", {
      sql,
      maxRows,
      queryTimeoutSec,
      autoCommit,
      readOnly,
    });
  }

  private handleRunError(
    error: unknown,
    statement: string,
    generation: number,
    startedAt: number,
    options?: QueryExecuteOptions,
  ): void {
    if (!this.isCurrentRun(generation)) {
      return;
    }

    if (this.cancelRequested || isCancelError(error)) {
      this.finishCancelled(statement, startedAt, options);
      return;
    }

    const message = formatErrorMessage(error, "Failed to execute query.");
    this.setState({
      status: "error",
      output: message,
      result: null,
      lastSql: statement,
    });
    this.recordHistory(
      options?.historySql ?? statement,
      "error",
      startedAt,
      message,
      options,
    );
    applySqlErrorMarkers(message, options?.sourceRange ?? null);
  }

  private finishCancelled(
    statement: string,
    startedAt: number,
    options?: QueryExecuteOptions,
  ): void {
    this.setState({
      status: "cancelled",
      output: "Query cancelled.",
      result: null,
      lastSql: statement,
    });
    this.recordHistory(
      options?.historySql ?? statement,
      "cancelled",
      startedAt,
      "Query cancelled.",
      options,
    );
  }

  private recordHistory(
    sql: string,
    status: QueryHistoryStatus,
    startedAt: number,
    summary: string,
    options?: QueryExecuteOptions,
  ): void {
    if (options?.skipHistory) return;

    const profile =
      ConnectionService.getConnectedProfile() ??
      ConnectionService.getActiveProfile();
    QueryHistoryService.record({
      sql,
      status,
      durationMs: performance.now() - startedAt,
      connectionProfileId: profile?.id ?? null,
      connectionName: profile?.name ?? null,
      driverId: profile?.driverId ?? null,
      summary,
    });
  }

  private isCurrentRun(generation: number): boolean {
    return generation === this.runGeneration;
  }

  private setState(next: QueryExecutionState): void {
    this.state = next;
    for (const listener of this.listeners) {
      listener();
    }
  }
}

function isCancelError(error: unknown): boolean {
  const message = formatErrorMessage(error, "").toLowerCase();
  return (
    message.includes("cancel") ||
    message.includes("ora-01013") ||
    message.includes("query was cancelled") ||
    message.includes("statement cancelled")
  );
}

export const QueryExecutionService = new QueryExecutionServiceImpl();
