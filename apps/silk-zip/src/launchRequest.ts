import { archiveStem, folderLabel, joinPath, parentFolder } from "./extractTargets";
import { tr } from "./i18n";

/**
 * Output file for a one-click compression: the item's own name (a folder keeps its dots, a file
 * loses its extension), or the parent folder's name when several items are selected.
 */
export function quickArchivePath(paths: string[], extension: "zip" | "7z", firstIsDirectory: boolean): string {
  const first = paths[0];
  const folder = parentFolder(first) ?? "";
  const name = paths.length === 1 ? (firstIsDirectory ? folderLabel(first) : archiveStem(first)) : folderLabel(folder) || tr("새 압축");
  return folder ? joinPath(folder, `${name}.${extension}`) : `${name}.${extension}`;
}
