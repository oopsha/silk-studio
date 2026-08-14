import { open as openFilePicker, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { ConfigurationService } from "@silk-studio/workbench/platform/configuration/configurationService.ts";

const JSON_FILTER = [{ name: "JSON", extensions: ["json"] }];

function formatTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/** Writes all current settings to a JSON file. No secrets involved — AI API keys live in the
 *  OS keyring, not in `ConfigurationService`. Returns `false` if the user cancels the dialog. */
export async function exportSettings(): Promise<boolean> {
  const payload = ConfigurationService.exportAll();
  const path = await save({
    defaultPath: `silk-settings-${formatTimestamp(new Date())}.json`,
    filters: JSON_FILTER,
  });
  if (!path) return false;

  await writeTextFile(path, JSON.stringify(payload, null, 2));
  return true;
}

/** Reads a settings export file and replaces current settings with it. Every individual key is
 *  validated/clamped by `ConfigurationService.importAll` — this only guards the file's
 *  top-level shape. Returns `false` if the user cancels the file picker. */
export async function importSettings(): Promise<boolean> {
  const path = await openFilePicker({ multiple: false, directory: false, filters: JSON_FILTER });
  if (typeof path !== "string") return false;

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readTextFile(path));
  } catch {
    throw new Error("The selected file is not valid JSON.");
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as Record<string, unknown>).formatVersion !== 1 ||
    typeof (parsed as Record<string, unknown>).settings !== "object"
  ) {
    throw new Error("The selected file is not a valid settings export.");
  }

  return ConfigurationService.importAll((parsed as { settings: unknown }).settings);
}
