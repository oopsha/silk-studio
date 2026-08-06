import { isTauri } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { EditorService } from "@silk-studio/editor/services/editor/editorService.ts";
import { readTextFileAtPath } from "@silk-studio/editor/services/editor/editorFileIO.ts";
import { tKey } from "@silk-studio/workbench/platform/i18n/activeLocale.ts";
import { AppNotificationService } from "@silk-studio/workbench/services/notifications/appNotificationService.ts";

type UnwatchFn = () => void;

function normalizePathKey(path: string): string {
  return path.trim().replace(/\\/g, "/").toLowerCase();
}

function isModifyOrCreateEvent(type: unknown): boolean {
  if (type === "any") return true;
  if (!type || typeof type !== "object") return false;
  const record = type as Record<string, unknown>;
  return "modify" in record || "create" in record || "any" in record;
}

/**
 * Watch open filesystem tabs for external edits (VS Code-style):
 * - clean tab → reload automatically
 * - dirty tab → confirm before overwriting local edits
 */
export function startExternalFileWatch(): () => void {
  if (!isTauri()) {
    return () => {};
  }

  let cancelled = false;
  let syncGeneration = 0;
  const watches = new Map<string, { path: string; unwatch: UnwatchFn }>();
  /** pathKey → disk content the user already declined to load */
  const declinedDiskContent = new Map<string, string>();
  const inFlight = new Set<string>();

  const stopAllWatches = () => {
    for (const entry of watches.values()) {
      try {
        entry.unwatch();
      } catch {
        // ignore
      }
    }
    watches.clear();
  };

  const handlePathChange = async (watchedPath: string) => {
    const pathKey = normalizePathKey(watchedPath);
    if (inFlight.has(pathKey)) return;
    inFlight.add(pathKey);

    try {
      const tab = EditorService.getFilesystemTabs().find(
        (item) =>
          item.uri && normalizePathKey(item.uri) === pathKey,
      );
      if (!tab?.uri) return;

      let diskContent: string;
      try {
        diskContent = await readTextFileAtPath(tab.uri);
      } catch (error) {
        console.warn("[silk.fileWatch] read failed", tab.uri, error);
        return;
      }

      // Our own save (or no real change).
      if (diskContent === tab.content) {
        declinedDiskContent.delete(pathKey);
        return;
      }

      if (!tab.isDirty) {
        EditorService.reloadTabFromDisk(tab.id, diskContent);
        declinedDiskContent.delete(pathKey);
        AppNotificationService.show(
          tKey("workbench.file.reloadedFromDisk").replace(
            "{name}",
            tab.label,
          ),
          "info",
          2500,
        );
        return;
      }

      if (declinedDiskContent.get(pathKey) === diskContent) {
        return;
      }

      const reload = await ask(
        tKey("workbench.file.externalChangeMessage").replace(
          "{name}",
          tab.label,
        ),
        {
          title: tKey("workbench.file.externalChangeTitle"),
          kind: "warning",
          okLabel: tKey("workbench.file.reloadFromDisk"),
          cancelLabel: tKey("workbench.file.keepLocalEdits"),
        },
      );

      if (cancelled) return;

      if (reload) {
        EditorService.reloadTabFromDisk(tab.id, diskContent);
        declinedDiskContent.delete(pathKey);
        AppNotificationService.show(
          tKey("workbench.file.reloadedFromDisk").replace(
            "{name}",
            tab.label,
          ),
          "info",
          2500,
        );
      } else {
        declinedDiskContent.set(pathKey, diskContent);
      }
    } finally {
      inFlight.delete(pathKey);
    }
  };

  const syncWatches = async () => {
    const generation = ++syncGeneration;
    const { watch } = await import("@tauri-apps/plugin-fs");
    if (cancelled || generation !== syncGeneration) return;

    const wanted = new Map<string, string>();
    for (const tab of EditorService.getFilesystemTabs()) {
      if (!tab.uri) continue;
      wanted.set(normalizePathKey(tab.uri), tab.uri);
    }

    for (const [key, entry] of [...watches.entries()]) {
      if (!wanted.has(key)) {
        try {
          entry.unwatch();
        } catch {
          // ignore
        }
        watches.delete(key);
        declinedDiskContent.delete(key);
      }
    }

    for (const [key, path] of wanted) {
      if (watches.has(key)) continue;
      try {
        const unwatch = await watch(
          path,
          (event) => {
            if (!isModifyOrCreateEvent(event.type)) return;
            void handlePathChange(path);
          },
          { delayMs: 400 },
        );
        if (cancelled || generation !== syncGeneration) {
          unwatch();
          return;
        }
        watches.set(key, { path, unwatch });
      } catch (error) {
        console.warn("[silk.fileWatch] watch failed", path, error);
      }
    }
  };

  const unsubscribe = EditorService.onDidChange(() => {
    void syncWatches();
  });
  void syncWatches();

  return () => {
    cancelled = true;
    unsubscribe();
    stopAllWatches();
    declinedDiskContent.clear();
    inFlight.clear();
  };
}
