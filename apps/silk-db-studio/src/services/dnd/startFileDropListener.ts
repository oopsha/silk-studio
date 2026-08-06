import { isTauri } from "@tauri-apps/api/core";
import { EditorService } from "@silk-studio/editor/services/editor/editorService.ts";
import { isOpenableTextPath } from "@silk-studio/editor/services/editor/languageFromPath.ts";
import { openDroppedFilePaths } from "@silk-studio/editor/services/editor/openDroppedFiles.ts";
import { AppNotificationService } from "@silk-studio/workbench/services/notifications/appNotificationService.ts";
import { tKey } from "@silk-studio/workbench/platform/i18n/activeLocale.ts";

/**
 * Listen for OS file drops onto the window and open text files as editor tabs.
 * Desktop: Tauri native drag-drop (absolute paths) — keep dragDropEnabled true
 * so File>Open and OS drop share the same path/save/watch behavior. In-app UI
 * DnD (tabs, explorer) uses pointer events, not HTML5, for WebView2 coexistence.
 * Browser: HTML5 File drop (name-only).
 */
export function startFileDropListener(): () => void {
  if (isTauri()) {
    return startTauriFileDrop();
  }
  return startBrowserFileDrop();
}

function startTauriFileDrop(): () => void {
  let unlisten: (() => void) | null = null;
  let cancelled = false;

  void (async () => {
    try {
      const { getCurrentWebview } = await import("@tauri-apps/api/webview");
      const stop = await getCurrentWebview().onDragDropEvent(async (event) => {
        if (event.payload.type !== "drop") return;
        const paths = event.payload.paths ?? [];
        if (paths.length === 0) return;
        await openPathsWithFeedback(paths);
      });
      if (cancelled) {
        stop();
        return;
      }
      unlisten = stop;
    } catch (error) {
      console.warn("[silk.fileDrop] failed to subscribe", error);
    }
  })();

  return () => {
    cancelled = true;
    unlisten?.();
    unlisten = null;
  };
}

function startBrowserFileDrop(): () => void {
  const onDragOver = (event: DragEvent) => {
    if (!Array.from(event.dataTransfer?.types ?? []).includes("Files")) return;
    event.preventDefault();
    event.dataTransfer!.dropEffect = "copy";
  };

  const onDrop = (event: DragEvent) => {
    const files = event.dataTransfer?.files;
    if (!files || files.length === 0) return;
    event.preventDefault();
    void openBrowserFiles(Array.from(files));
  };

  window.addEventListener("dragover", onDragOver);
  window.addEventListener("drop", onDrop);
  return () => {
    window.removeEventListener("dragover", onDragOver);
    window.removeEventListener("drop", onDrop);
  };
}

async function openBrowserFiles(files: File[]): Promise<void> {
  let opened = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const file of files.slice(0, 20)) {
    if (!isOpenableTextPath(file.name)) {
      skipped += 1;
      continue;
    }
    try {
      const content = await file.text();
      EditorService.openFile(file.name, content, false);
      opened += 1;
    } catch (error) {
      errors.push(
        `${file.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  reportOpenResult(opened, skipped, errors);
}

async function openPathsWithFeedback(paths: string[]): Promise<void> {
  const result = await openDroppedFilePaths(paths);
  reportOpenResult(result.opened, result.skipped, result.errors);
}

function reportOpenResult(
  opened: number,
  skipped: number,
  errors: string[],
): void {
  if (opened === 0 && skipped === 0 && errors.length === 0) return;

  if (opened > 0 && errors.length === 0 && skipped === 0) {
    AppNotificationService.show(
      tKey("app.dnd.filesOpened").replace("{n}", String(opened)),
      "success",
    );
    return;
  }

  const parts = [
    opened > 0
      ? tKey("app.dnd.filesOpened").replace("{n}", String(opened))
      : null,
    skipped > 0
      ? tKey("app.dnd.filesSkipped").replace("{n}", String(skipped))
      : null,
    errors.length > 0
      ? tKey("app.dnd.filesFailed").replace("{n}", String(errors.length))
      : null,
  ].filter(Boolean);

  AppNotificationService.show(
    parts.join(" · ") || tKey("app.dnd.filesNone"),
    errors.length > 0 ? "error" : "info",
  );
}
