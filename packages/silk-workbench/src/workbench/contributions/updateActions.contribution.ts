import { isTauri } from "@tauri-apps/api/core";
import { CommandsRegistry } from "../../platform/commands/commandRegistry";
import { checkForUpdates } from "../../services/updates/updateService";

CommandsRegistry.registerCommand("update.check", () => {
  void checkForUpdates();
});

// Automatic background check, the way most desktop apps (VS Code, Chrome, Slack) handle
// updates — the user shouldn't have to remember to open Manage → Check for Updates. Silent
// when already up to date; only interrupts with a prompt when a newer build actually exists.
const AUTO_CHECK_INITIAL_DELAY_MS = 10_000;
const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

if (isTauri()) {
  setTimeout(() => {
    void checkForUpdates({ silentWhenUpToDate: true });
  }, AUTO_CHECK_INITIAL_DELAY_MS);

  setInterval(() => {
    void checkForUpdates({ silentWhenUpToDate: true });
  }, AUTO_CHECK_INTERVAL_MS);
}
