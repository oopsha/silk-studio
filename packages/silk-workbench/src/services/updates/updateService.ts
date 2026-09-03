import { ask } from "@tauri-apps/plugin-dialog";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { isTauri } from "@tauri-apps/api/core";
import { AppNotificationService } from "../notifications/appNotificationService";
import { AppLogService } from "../diagnostics/appLogService";

function formatError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return String(error);
}

/**
 * Check GitHub Releases (latest.json) for a newer signed build and optionally install.
 *
 * `silentWhenUpToDate` doubles as "this is a background check, not a user-initiated one" —
 * it also skips the "Checking…" toast and downgrades failures to a log entry instead of an
 * error toast, so a periodic auto-check stays invisible except for the one thing worth
 * interrupting for: an update actually being available.
 */
export async function checkForUpdates(options?: {
  silentWhenUpToDate?: boolean;
}): Promise<void> {
  const silent = options?.silentWhenUpToDate ?? false;

  if (!isTauri()) {
    if (!silent) {
      AppNotificationService.show(
        "Updates are only available in the desktop app.",
        "info",
      );
    }
    return;
  }

  if (!silent) {
    AppNotificationService.show("Checking for updates…", "info");
  }

  try {
    const update = await check();
    if (!update) {
      if (!silent) {
        AppNotificationService.show("You're on the latest version.", "success");
      }
      return;
    }

    const notes = update.body?.trim();
    const detail = notes ? `\n\n${notes}` : "";
    const confirmed = await ask(
      `Version ${update.version} is available.${detail}\n\nDownload and install now? The app will restart.`,
      {
        title: "Update available",
        kind: "info",
        okLabel: "Update",
        cancelLabel: "Later",
      },
    );

    if (!confirmed) {
      AppNotificationService.show(
        `Update ${update.version} is available. Run Check for Updates when ready.`,
        "info",
      );
      return;
    }

    AppNotificationService.show(`Downloading ${update.version}…`, "info");
    await update.downloadAndInstall();
    AppNotificationService.show("Update installed. Restarting…", "success");
    await relaunch();
  } catch (error) {
    const message = formatError(error);
    void AppLogService.error(message, "update.check");
    if (silent) return;

    if (
      message.includes("REPLACE_AFTER_tauri_signer_generate") ||
      message.toLowerCase().includes("public key") ||
      message.toLowerCase().includes("pubkey")
    ) {
      AppNotificationService.show(
        "Updater signing key is not configured yet. See docs/release.md.",
        "error",
      );
      return;
    }

    if (
      message.includes("404") ||
      message.toLowerCase().includes("not found") ||
      message.toLowerCase().includes("no release")
    ) {
      AppNotificationService.show(
        "No published update feed found yet (GitHub Releases latest.json).",
        "info",
      );
      return;
    }

    AppNotificationService.show(`Update check failed: ${message}`, "error");
  }
}
