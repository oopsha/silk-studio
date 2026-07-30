import type { ConnectionCompileError } from "@silk-studio/db-protocol";

export type PlsqlCompileStatus =
  | "idle"
  | "compiling"
  | "success"
  | "error"
  | "failed";

export type PlsqlCompileState = {
  tabId: string | null;
  status: PlsqlCompileStatus;
  message: string;
  errors: ConnectionCompileError[];
};

type PlsqlCompileListener = () => void;

const INITIAL_STATE: PlsqlCompileState = {
  tabId: null,
  status: "idle",
  message: "",
  errors: [],
};

class PlsqlCompileStateServiceImpl {
  private state: PlsqlCompileState = INITIAL_STATE;
  private readonly listeners = new Set<PlsqlCompileListener>();

  getState(): PlsqlCompileState {
    return this.state;
  }

  setCompiling(tabId: string): void {
    this.state = {
      tabId,
      status: "compiling",
      message: "Compiling…",
      errors: [],
    };
    this.fire();
  }

  setResult(
    tabId: string,
    success: boolean,
    errors: ConnectionCompileError[],
  ): void {
    this.state = {
      tabId,
      status: success ? "success" : "error",
      message: success
        ? "Compiled successfully."
        : `${errors.length} compile error${errors.length === 1 ? "" : "s"}.`,
      errors,
    };
    this.fire();
  }

  setFailed(tabId: string, message: string): void {
    this.state = {
      tabId,
      status: "failed",
      message,
      errors: [],
    };
    this.fire();
  }

  clear(tabId?: string): void {
    if (tabId && this.state.tabId && this.state.tabId !== tabId) {
      return;
    }
    this.state = INITIAL_STATE;
    this.fire();
  }

  onDidChange(listener: PlsqlCompileListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private fire(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const PlsqlCompileStateService = new PlsqlCompileStateServiceImpl();
