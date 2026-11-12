import { EditorService } from "./editorServiceFacade";
import { readTextFileAtPath } from "./editorFileIO";
import { isOpenableTextPath } from "./languageFromPath";

const MAX_OPEN_FILES = 20;

export type OpenDroppedFilesResult = {
  opened: number;
  skipped: number;
  errors: string[];
};

export type OpenableTextFile = { path: string; content: string };

/** Open already-read text files, applying the same extension and count limits as OS drops. */
export function openTextFileContents(
  files: OpenableTextFile[],
  initiallySkipped = 0,
): OpenDroppedFilesResult {
  const errors: string[] = [];
  let opened = 0;
  const candidates = files.filter((file) => isOpenableTextPath(file.path));
  const skipped = files.length - candidates.length;
  const limited = candidates.slice(0, MAX_OPEN_FILES);

  for (const file of limited) {
    try {
      EditorService.openFile(file.path, file.content, false);
      opened += 1;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error ?? "Unknown error");
      errors.push(`${file.path}: ${message}`);
    }
  }

  return {
    opened,
    skipped: initiallySkipped + skipped + Math.max(0, candidates.length - limited.length),
    errors,
  };
}

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

  const limited = candidates.slice(0, MAX_OPEN_FILES);
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
