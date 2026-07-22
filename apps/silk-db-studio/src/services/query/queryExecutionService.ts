import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  isQueryResultPayload,
  type QueryResultPayload,
} from "@silk-studio/db-protocol";
import { ConfigurationService } from "@silk-studio/workbench/platform/configuration/configurationService.ts";
import { formatErrorMessage } from "../formatErrorMessage";
import { ConnectionService } from "../connection/connectionService";
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

  async execute(sql: string): Promise<void> {
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

    this.setState({
      status: "running",
      output: "Executing query...",
      result: null,
      lastSql: statement,
    });

    try {
      if (!isTauri()) {
        if (!this.isCurrentRun(generation)) return;
        this.setState({
          status: "success",
          output: `Desktop-only JDBC execution.\n\nSQL:\n${statement}`,
          result: null,
          lastSql: statement,
        });
        return;
      }

      const readOnly = ConfigurationService.getValue("database.readOnly");
      assertReadOnlyQueryAllowed(statement, readOnly);

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

      const maxRows = ConfigurationService.getValue("queryResult.maxRows");
      const queryTimeoutSec = ConfigurationService.getValue(
        "database.queryTimeoutSec",
      );
      const autoCommit = ConfigurationService.getValue("database.autoCommit");
      const payload = await invoke<unknown>("query_execute", {
        sql: statement,
        maxRows,
        queryTimeoutSec,
        autoCommit,
        readOnly,
      });

      if (!this.isCurrentRun(generation)) {
        return;
      }

      if (this.cancelRequested) {
        this.setState({
          status: "cancelled",
          output: "Query cancelled.",
          result: null,
          lastSql: statement,
        });
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
    } catch (error) {
      if (!this.isCurrentRun(generation)) {
        return;
      }

      if (this.cancelRequested || isCancelError(error)) {
        this.setState({
          status: "cancelled",
          output: "Query cancelled.",
          result: null,
          lastSql: statement,
        });
        return;
      }

      const message = formatErrorMessage(error, "Failed to execute query.");
      this.setState({
        status: "error",
        output: message,
        result: null,
        lastSql: statement,
      });
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
