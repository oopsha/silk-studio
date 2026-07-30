import { invoke, isTauri } from "@tauri-apps/api/core";
import { AppLogService } from "./appLogService";
import {
  APP_DISPLAY_NAME,
  APP_VERSION,
  type AppRuntimeInfo,
} from "./appVersion";
import { DiagnosticsHost } from "./diagnosticsHost";
import { sanitizeLogMessage } from "./redactSecrets";

export async function fetchAppRuntimeInfo(): Promise<AppRuntimeInfo | null> {
  if (!isTauri()) {
    return {
      appName: APP_DISPLAY_NAME,
      appVersion: APP_VERSION,
      tauriVersion: "(browser)",
      os: navigator.platform || "unknown",
      arch: "unknown",
      agentJarPresent: false,
      agentJarPath: "",
      agentBundled: false,
      javaBinPath: "java",
      javaBundled: false,
      logDir: "(not available in browser)",
      logFile: "(not available in browser)",
    };
  }

  try {
    return await invoke<AppRuntimeInfo>("app_runtime_info");
  } catch (error) {
    void AppLogService.warn(
      `Failed to fetch runtime info: ${String(error)}`,
      "diagnostics",
    );
    return null;
  }
}

export async function openLogFolder(): Promise<void> {
  if (!isTauri()) {
    throw new Error("Log folder is only available in the desktop app.");
  }
  await invoke("app_log_open_folder");
}

function formatRecentErrors(): string {
  const errors = AppLogService.getRecentErrors();
  if (errors.length === 0) {
    return "(none)";
  }
  return errors
    .slice(0, 15)
    .map((entry) => {
      const when = new Date(entry.at).toISOString();
      return `- ${when} [${entry.source}] ${entry.message}`;
    })
    .join("\n");
}

function formatConnectionSummary(): string {
  const summary = DiagnosticsHost.getConnectionSummary();
  if (!summary) {
    return "status: unknown (host not configured)";
  }
  const parts = [`status: ${summary.status}`];
  if (summary.profileName) {
    parts.push(`profile: ${sanitizeLogMessage(summary.profileName)}`);
  }
  if (summary.driverId) {
    parts.push(`driver: ${summary.driverId}`);
  }
  if (summary.hostHint) {
    parts.push(`hint: ${sanitizeLogMessage(summary.hostHint)}`);
  }
  return parts.join("\n");
}

export async function buildDiagnosticsText(): Promise<string> {
  const runtime = await fetchAppRuntimeInfo();
  const lines: string[] = [
    `${APP_DISPLAY_NAME} diagnostics`,
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Versions",
    `App: ${runtime?.appVersion ?? APP_VERSION}`,
    `Tauri: ${runtime?.tauriVersion ?? "unknown"}`,
    `jdbc-agent jar: ${
      runtime
        ? `${runtime.agentJarPresent ? "present" : "missing"}${
            runtime.agentBundled ? " (bundled)" : " (dev path)"
          }`
        : "unknown"
    }`,
    `Java: ${
      runtime
        ? `${runtime.javaBinPath}${runtime.javaBundled ? " (bundled)" : " (PATH/dev)"}`
        : "unknown"
    }`,
    "",
    "## Environment",
    `OS: ${runtime?.os ?? "unknown"}`,
    `Arch: ${runtime?.arch ?? "unknown"}`,
    `User agent: ${navigator.userAgent}`,
    "",
    "## Connection (summary only — no passwords)",
    formatConnectionSummary(),
    "",
    "## Recent errors (redacted)",
    formatRecentErrors(),
    "",
    "## Logs",
    `Log dir: ${runtime?.logDir ?? "(unknown)"}`,
    `Log file: ${runtime?.logFile ?? "(unknown)"}`,
    "",
    "Note: API keys, passwords, and long prompts are excluded.",
  ];
  return lines.join("\n");
}

export async function copyDiagnostics(): Promise<string> {
  const text = await buildDiagnosticsText();
  await navigator.clipboard.writeText(text);
  void AppLogService.info("Diagnostics copied to clipboard.", "diagnostics");
  return text;
}
