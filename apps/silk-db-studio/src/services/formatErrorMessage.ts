import { AppLogService } from "@silk-studio/workbench/services/diagnostics/appLogService.ts";

export function formatErrorMessage(
  error: unknown,
  fallback = "Operation failed.",
): string {
  if (error instanceof Error) {
    return error.message.trim() || fallback;
  }

  if (typeof error === "string") {
    return error.trim() || fallback;
  }

  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    if (typeof record.message === "string" && record.message.trim()) {
      return record.message.trim();
    }
  }

  return fallback;
}

/** Format for UI and record in the diagnostics ring buffer / log file. */
export function reportError(
  error: unknown,
  source: string,
  fallback = "Operation failed.",
): string {
  const message = formatErrorMessage(error, fallback);
  void AppLogService.error(message, source);
  return message;
}
