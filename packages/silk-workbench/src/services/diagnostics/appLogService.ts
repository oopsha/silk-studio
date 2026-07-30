import { invoke, isTauri } from "@tauri-apps/api/core";
import { sanitizeLogMessage } from "./redactSecrets";

export type AppLogLevel = "debug" | "info" | "warn" | "error";

export type RecentErrorEntry = {
  at: number;
  source: string;
  message: string;
};

const MAX_RECENT_ERRORS = 30;

type AppLogListener = () => void;

class AppLogServiceImpl {
  private readonly recentErrors: RecentErrorEntry[] = [];
  private readonly listeners = new Set<AppLogListener>();
  private installedGlobalHandlers = false;

  getRecentErrors(): RecentErrorEntry[] {
    return this.recentErrors.slice();
  }

  onDidChange(listener: AppLogListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Install once from app bootstrap — captures uncaught errors without secrets. */
  installGlobalHandlers(): void {
    if (this.installedGlobalHandlers || typeof window === "undefined") {
      return;
    }
    this.installedGlobalHandlers = true;

    window.addEventListener("error", (event) => {
      const message =
        event.error instanceof Error
          ? event.error.message
          : event.message || "Uncaught error";
      void this.error(message, "window.error");
    });

    window.addEventListener("unhandledrejection", (event) => {
      const reason = event.reason;
      const message =
        reason instanceof Error
          ? reason.message
          : typeof reason === "string"
            ? reason
            : "Unhandled promise rejection";
      void this.error(message, "unhandledrejection");
    });
  }

  async debug(message: string, source = "app"): Promise<void> {
    await this.write("debug", message, source);
  }

  async info(message: string, source = "app"): Promise<void> {
    await this.write("info", message, source);
  }

  async warn(message: string, source = "app"): Promise<void> {
    await this.write("warn", message, source);
  }

  async error(message: string, source = "app"): Promise<void> {
    const safe = sanitizeLogMessage(message);
    this.pushRecentError(source, safe);
    await this.write("error", safe, source, false);
  }

  private pushRecentError(source: string, message: string): void {
    this.recentErrors.unshift({
      at: Date.now(),
      source: source.slice(0, 64),
      message,
    });
    if (this.recentErrors.length > MAX_RECENT_ERRORS) {
      this.recentErrors.length = MAX_RECENT_ERRORS;
    }
    this.fireDidChange();
  }

  private async write(
    level: AppLogLevel,
    message: string,
    source: string,
    sanitize = true,
  ): Promise<void> {
    const safe = sanitize ? sanitizeLogMessage(message) : message;
    const line = `[${source}] ${safe}`;

    if (level === "error") {
      console.error(line);
    } else if (level === "warn") {
      console.warn(line);
    } else {
      console.info(line);
    }

    if (!isTauri()) {
      return;
    }

    try {
      await invoke("app_log_write", { level, message: line });
    } catch {
      // Logging must never break the app.
    }
  }

  private fireDidChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const AppLogService = new AppLogServiceImpl();
