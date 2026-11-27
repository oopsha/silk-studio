import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { detectWorkbenchPlatform } from "@silk-studio/ui/platform/fonts.ts";
import { parentFolder, type ExtractTarget } from "./extractTargets.ts";
import { getZipSettings, updateZipSettings } from "./zipSettings.ts";
import { tr } from "./i18n";

/**
 * Asks where to extract; `null` when cancelled. On Windows the dialog also offers a folder named
 * after each archive, and remembers that choice.
 */
export async function pickExtractFolder(archivePath: string, count = 1): Promise<Exclude<ExtractTarget, string> | null> {
  const defaultPath = parentFolder(archivePath);
  if (detectWorkbenchPlatform() !== "windows") {
    const dir = await open({ multiple: false, directory: true, title: tr("압축을 풀 폴더 선택"), defaultPath });
    return !dir || Array.isArray(dir) ? null : { dir };
  }
  const picked = await invoke<{ dir: string; named: boolean } | null>("pick_extract_folder", {
    archivePath,
    count,
    named: getZipSettings().extractNamedFolder,
  });
  if (picked) updateZipSettings({ extractNamedFolder: picked.named });
  return picked;
}
