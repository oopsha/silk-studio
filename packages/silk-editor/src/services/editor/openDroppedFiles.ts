import { EditorService } from "./editorService";
import { readTextFileAtPath } from "./editorFileIO";
import { isOpenableTextPath } from "./languageFromPath";

const MAX_DROP_FILES = 20;

export type OpenDroppedFilesResult = {
  opened: number;
  skipped: number;
  errors: string[];
};

/**
 * Open OS-dropped (or otherwise path-based) text files as editor tabs.
 * Skips unknown/binary-looking extensions; caps concurrent opens.
 */
export async function openDroppedFilePaths(
  paths: string[],
): Promise<OpenDroppedFilesResult> {
  const errors: string[] = [];
  let opened = 0;
  let skipped = 0;

  const candidates = paths.filter((path) => {
    if (!path?.trim()) {
      skipped += 1;
      return false;
    }
    if (!isOpenableTextPath(path)) {
      skipped += 1;
      return false;
    }
    return true;
  });

  const limited = candidates.slice(0, MAX_DROP_FILES);
  skipped += Math.max(0, candidates.length - limited.length);

  for (const path of limited) {
    try {
      const content = await readTextFileAtPath(path);
      EditorService.openFile(path, content, false);
      opened += 1;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error ?? "Unknown error");
      errors.push(`${path}: ${message}`);
    }
  }

  return { opened, skipped, errors };
}
