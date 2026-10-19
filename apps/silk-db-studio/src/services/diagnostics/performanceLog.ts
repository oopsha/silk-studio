import { AppLogService } from "@silk-studio/workbench/services/diagnostics/appLogService.ts";

const SLOW_OPERATION_THRESHOLD_MS = 250;

/** Write timings only for slow operations; never include SQL text or entered values. */
export function logSlowOperation(
  source: string,
  operation: string,
  startedAt: number,
  details?: string,
): void {
  const durationMs = Math.round(performance.now() - startedAt);
  if (durationMs < SLOW_OPERATION_THRESHOLD_MS) return;
  const suffix = details ? ` ${details}` : "";
  void AppLogService.info(`${operation} durationMs=${durationMs}${suffix}`, source);
}
