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
import {
  buildQueryResultTabTitle,
  MAX_QUERY_RESULT_TABS,
  type QueryResultTab,
  type QueryResultTabStatus,
} from "./queryResultTab";

export type QueryExecutionStatus =
  | "idle"
  | "running"
  | "success"
  | "error"
  | "cancelled";

export type QueryExecutionState = {
  status: QueryExecutionStatus;
  /** Status-line / message for the current run or active tab. */
  output: string;
  /** Active tab result (convenience mirror). */
  result: QueryResultPayload | null;
  lastSql: string;
  tabs: QueryResultTab[];
  activeTabId: string | null;
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
  tabs: [],
  activeTabId: null,
};

class QueryExecutionServiceImpl {
  private state: QueryExecutionState = INITIAL_STATE;
  private readonly listeners = new Set<QueryExecutionListener>();
  /** Monotonic token so a late response after cancel/re-run is ignored. */
  private runGeneration = 0;
  private cancelRequested = false;
  private tabSequence = 0;
  /** 1-based index within the current execute batch (reset each run). */
  private runTabOrdinal = 0;

  getState(): QueryExecutionState {
    return this.state;
  }

  isRunning(): boolean {
    return this.state.status === "running";
  }

  setActiveTab(tabId: string): void {
    const tab = this.state.tabs.find((item) => item.id === tabId);
    if (!tab) return;
    this.setState({
      ...this.state,
      status: tab.status === "success" ? "success" : tab.status,
      output: tab.output,
      result: tab.result,
      lastSql: tab.sql,
      activeTabId: tab.id,
    });
  }

  closeTab(tabId: string): void {
    const tabs = this.state.tabs.filter((item) => item.id !== tabId);
    if (tabs.length === this.state.tabs.length) return;

    if (tabs.length === 0) {
      this.setState({
        status: "idle",
        output: "Run a SQL statement to see results.",
        result: null,
        lastSql: this.state.lastSql,
        tabs: [],
        activeTabId: null,
      });
      return;
    }

    const closingActive = this.state.activeTabId === tabId;
    let activeTabId = this.state.activeTabId;
    if (closingActive) {
      const closedIndex = this.state.tabs.findIndex((item) => item.id === tabId);
      const next =
        tabs[Math.min(closedIndex, tabs.length - 1)] ?? tabs[tabs.length - 1];
      activeTabId = next.id;
    }

    const active = tabs.find((item) => item.id === activeTabId) ?? tabs[0];
    this.setState({
      status: active.status === "success" ? "success" : active.status,
      output: active.output,
      result: active.result,
      lastSql: active.sql,
      tabs,
      activeTabId: active.id,
    });
  }

  closeAllTabs(): void {
    this.setState({
      status: this.state.status === "running" ? "running" : "idle",
      output:
        this.state.status === "running"
          ? this.state.output
          : "Run a SQL statement to see results.",
      result: null,
      lastSql: this.state.lastSql,
      tabs: [],
      activeTabId: null,
    });
  }

  async execute(sql: string, options?: QueryExecuteOptions): Promise<void> {
    const statement = stripTrailingSemicolon(sql.trim());
    if (!statement) {
      this.patchRunStatus({
        status: "error",
        output: "Query is empty. Write SQL in the editor and run again.",
        lastSql: sql,
      });
      return;
    }

    await this.executeStatements(
      [{ sql: statement, range: options?.sourceRange }],
      options,
    );
  }

  /**
   * Run one or more statements sequentially. Each statement becomes its own tab
   * for this run only — a new execute replaces all prior result tabs.
   */
  async executeStatements(
    statements: Array<{ sql: string; range?: SqlSourceRange }>,
    options?: QueryExecuteOptions,
  ): Promise<void> {
    const prepared = statements
      .map((item) => ({
        sql: stripTrailingSemicolon(item.sql.trim()),
        range: item.range,
      }))
      .filter((item) => item.sql.length > 0);

    if (prepared.length === 0) {
      this.patchRunStatus({
        status: "error",
        output: "Query is empty. Write SQL in the editor and run again.",
      });
      return;
    }

    const generation = ++this.runGeneration;
    this.cancelRequested = false;
    clearSqlErrorMarkers();

    const total = prepared.length;
    this.beginRun(
      prepared[0].sql,
      total === 1 ? "Executing query..." : `Executing 1/${total}...`,
    );

    try {
      if (!isTauri()) {
        if (!this.isCurrentRun(generation)) return;
        for (let index = 0; index < prepared.length; index += 1) {
          if (!this.isCurrentRun(generation) || this.cancelRequested) {
            this.finishCancelled(prepared[index].sql, performance.now(), options);
            return;
          }
          const item = prepared[index];
          const output = `Desktop-only JDBC execution.\n\nSQL:\n${item.sql}`;
          this.commitTab({
            sql: item.sql,
            output,
            result: null,
            status: "success",
          });
          this.recordHistory(item.sql, "success", performance.now(), output, options);
        }
        return;
      }

      const readOnly = ConfigurationService.getValue("database.readOnly");
      await this.ensureConnected();

      for (let index = 0; index < prepared.length; index += 1) {
        if (!this.isCurrentRun(generation)) {
          return;
        }
        if (this.cancelRequested) {
          this.finishCancelled(prepared[index].sql, performance.now(), options);
          return;
        }

        const item = prepared[index];
        if (total > 1) {
          this.patchRunStatus({
            status: "running",
            output: `Executing ${index + 1}/${total}...`,
            lastSql: item.sql,
          });
        }

        const startedAt = performance.now();
        try {
          assertReadOnlyQueryAllowed(item.sql, readOnly);
          const payload = await this.invokeQuery(item.sql, readOnly);

          if (!this.isCurrentRun(generation)) {
            return;
          }
          if (this.cancelRequested) {
            this.finishCancelled(item.sql, startedAt, options);
            return;
          }
          if (!isQueryResultPayload(payload)) {
            throw new Error("Invalid query result payload from desktop bridge.");
          }

          this.commitTab({
            sql: item.sql,
            output: payload.message,
            result: payload,
            status: "success",
          });
          this.recordHistory(
            options?.historySql && total === 1
              ? options.historySql
              : item.sql,
            "success",
            startedAt,
            payload.message,
            options,
          );
        } catch (error) {
          if (!this.isCurrentRun(generation)) {
            return;
          }
          if (this.cancelRequested || isCancelError(error)) {
            this.finishCancelled(item.sql, startedAt, options);
            return;
          }

          const message = formatErrorMessage(error, "Failed to execute query.");
          this.commitTab({
            sql: item.sql,
            output: message,
            result: null,
            status: "error",
          });
          this.recordHistory(item.sql, "error", startedAt, message, options);
          applySqlErrorMarkers(message, item.range ?? null);
          // Continue remaining statements so N selections still yield N tabs.
        }
      }
    } catch (error) {
      // Connection / setup failure before any statement.
      this.handleRunError(
        error,
        prepared[0].sql,
        generation,
        performance.now(),
        { ...options, sourceRange: prepared[0].range },
      );
    }
  }

  /**
   * Runs a driver-specific Explain / Explain Plan for the given statement and
   * shows the plan result in the panel (same result grid as normal execute).
   */
  async explain(sql: string, options?: QueryExecuteOptions): Promise<void> {
    const statement = stripTrailingSemicolon(sql.trim());
    if (!statement) {
      this.patchRunStatus({
        status: "error",
        output: "Query is empty. Write SQL in the editor and explain again.",
        lastSql: sql,
      });
      return;
    }

    const driverId = resolveActiveDriverId();
    const plan = buildExplainPlan(driverId, statement);
    if (plan.steps.length === 0) {
      this.patchRunStatus({
        status: "error",
        output: "Nothing to explain.",
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

    this.beginRun(displaySql, `Running ${plan.label}...`);

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
        this.commitTab({
          sql: displaySql,
          output,
          result: null,
          status: "success",
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

      const output = capturedMessage || `${plan.label} completed.`;
      this.commitTab({
        sql: displaySql,
        output,
        result: captured,
        status: "success",
      });
      this.recordHistory(
        historySql,
        "success",
        startedAt,
        output,
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
    this.patchRunStatus({
      status: "running",
      output: "Cancelling query...",
    });

    if (!isTauri()) {
      this.runGeneration += 1;
      this.setState({
        ...this.state,
        status: "cancelled",
        output: "Query cancelled.",
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

  private beginRun(sql: string, output: string): void {
    this.runTabOrdinal = 0;
    this.setState({
      ...this.state,
      status: "running",
      output,
      lastSql: sql,
      result: null,
      tabs: [],
      activeTabId: null,
    });
  }

  private commitTab(input: {
    sql: string;
    output: string;
    result: QueryResultPayload | null;
    status: QueryResultTabStatus;
  }): void {
    this.runTabOrdinal += 1;
    this.tabSequence += 1;
    const tab: QueryResultTab = {
      id: `result-${this.tabSequence}-${Date.now()}`,
      title: buildQueryResultTabTitle(
        input.sql,
        input.result,
        this.runTabOrdinal,
      ),
      sql: input.sql,
      status: input.status,
      output: input.output,
      result: input.result,
      createdAt: Date.now(),
    };

    let tabs = [...this.state.tabs, tab];
    if (tabs.length > MAX_QUERY_RESULT_TABS) {
      tabs = tabs.slice(tabs.length - MAX_QUERY_RESULT_TABS);
    }

    this.setState({
      status: input.status === "success" ? "success" : input.status,
      output: input.output,
      result: input.result,
      lastSql: input.sql,
      tabs,
      activeTabId: tab.id,
    });
  }

  private patchRunStatus(patch: {
    status: QueryExecutionStatus;
    output: string;
    lastSql?: string;
  }): void {
    this.setState({
      ...this.state,
      status: patch.status,
      output: patch.output,
      lastSql: patch.lastSql ?? this.state.lastSql,
    });
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
      ...this.state,
      status: "error",
      output: message,
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
      ...this.state,
      status: "cancelled",
      output: "Query cancelled.",
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
