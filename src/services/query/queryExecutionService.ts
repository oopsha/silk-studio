import { invoke, isTauri } from "@tauri-apps/api/core";

export type QueryExecutionStatus = "idle" | "running" | "success" | "error";

export type QueryExecutionState = {
  status: QueryExecutionStatus;
  output: string;
  lastSql: string;
};

type QueryExecutionListener = () => void;

const INITIAL_STATE: QueryExecutionState = {
  status: "idle",
  output: "Run a SQL statement to see results.",
  lastSql: "",
};

class QueryExecutionServiceImpl {
  private state: QueryExecutionState = INITIAL_STATE;
  private readonly listeners = new Set<QueryExecutionListener>();

  getState(): QueryExecutionState {
    return this.state;
  }

  async execute(sql: string): Promise<void> {
    const statement = sql.trim();
    if (!statement) {
      this.setState({
        status: "error",
        output: "Query is empty. Write SQL in the editor and run again.",
        lastSql: sql,
      });
      return;
    }

    this.setState({
      status: "running",
      output: "Executing query...",
      lastSql: statement,
    });

    try {
      let output = "";
      if (isTauri()) {
        output = await invoke<string>("query_execute", { sql: statement });
      } else {
        output = `Desktop-only JDBC execution.\n\nSQL:\n${statement}`;
      }

      this.setState({
        status: "success",
        output,
        lastSql: statement,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : "Failed to execute query.";
      this.setState({
        status: "error",
        output: message,
        lastSql: statement,
      });
    }
  }

  onDidChange(listener: QueryExecutionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setState(next: QueryExecutionState): void {
    this.state = next;
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const QueryExecutionService = new QueryExecutionServiceImpl();
