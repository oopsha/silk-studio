import { ask } from "@tauri-apps/plugin-dialog";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { isTauri } from "@tauri-apps/api/core";
import { AppNotificationService } from "../notifications/appNotificationService";
import { AppLogService } from "../diagnostics/appLogService";
import { tKey } from "../../platform/i18n/activeLocale";

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
      AppNotificationService.show(tKey("workbench.update.desktopOnly"), "info");
    }
    return;
  }

  if (!silent) {
    AppNotificationService.show(tKey("workbench.update.checking"), "info");
  }

  try {
    const update = await check();
    if (!update) {
      if (!silent) {
        AppNotificationService.show(tKey("workbench.update.upToDate"), "success");
      }
      return;
    }

    const notes = update.body?.trim();
    const detail = notes ? `\n\n${notes}` : "";
    const confirmed = await ask(
      tKey("workbench.update.prompt")
        .replace("{version}", update.version)
        .replace("{detail}", detail),
      {
        title: tKey("workbench.update.title"),
        kind: "info",
        okLabel: tKey("workbench.update.confirmLabel"),
        cancelLabel: tKey("workbench.update.cancelLabel"),
      },
    );

    if (!confirmed) {
      AppNotificationService.show(
        tKey("workbench.update.laterNotice").replace(
          "{version}",
          update.version,
        ),
        "info",
      );
      return;
    }

    AppNotificationService.show(
      tKey("workbench.update.downloading").replace("{version}", update.version),
      "info",
    );
    await update.downloadAndInstall();
    AppNotificationService.show(tKey("workbench.update.installed"), "success");
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
        tKey("workbench.update.signingKeyMissing"),
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
        tKey("workbench.update.feedNotFound"),
        "info",
      );
      return;
    }

    AppNotificationService.show(
      tKey("workbench.update.checkFailed").replace("{message}", message),
      "error",
    );
  }
}
