import type { ArchiveListing } from "./archive";
import { archiveNodePath } from "./archiveSource";

let highlighted: HTMLElement | null = null;

/** Marks the folder row (list or tree) that a drop would land in. */
export function highlightDropTarget(element: HTMLElement | null): void {
  if (highlighted === element) return;
  highlighted?.classList.remove("zip-drop-target");
  highlighted = element;
  highlighted?.classList.add("zip-drop-target");
}

/**
 * The archive folder a file dropped at `position` goes to: the folder row or tree item under the pointer,
 * otherwise `fallback` (the folder shown in the list). `position` is in physical pixels, as Tauri reports it.
 */
export function findDropFolder(position: { x: number; y: number }, view: ArchiveListing | null, fallback: string): { folder: string; element: HTMLElement | null } {
  if (!view) return { folder: fallback, element: null };
  const scale = window.devicePixelRatio || 1;
  const hit = document.elementFromPoint(position.x / scale, position.y / scale);
  const row = hit?.closest<HTMLElement>("[data-resource-id]") ?? null;
  const id = row?.getAttribute("data-resource-id");
  if (row && id && id.startsWith("directory:")) {
    const path = archiveNodePath(view, { id, name: "", directory: true });
    return { folder: path ?? "", element: row };
  }
  return { folder: fallback, element: null };
}
