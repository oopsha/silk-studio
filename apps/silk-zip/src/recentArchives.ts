import { readBrowserCopy, syncStored, writeStored } from "@silk-studio/workbench/services/storage/fileStore.ts";
import { CommandsRegistry } from "@silk-studio/workbench/platform/commands/commandRegistry.ts";
import { MenuId } from "@silk-studio/workbench/platform/actions/menuId.ts";
import { MenuRegistry } from "@silk-studio/workbench/platform/actions/menuRegistry.ts";

const STORAGE_KEY = "silk-zip.recent-archives.v1";
const MAX_RECENT = 10;

function parseRecent(text: string | null): string[] {
  try {
    const value: unknown = JSON.parse(text ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function archiveName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function startRecentArchives(openArchive: (path: string) => void): {
  record: (path: string) => void;
  stop: () => void;
} {
  let disposers: (() => void)[] = [];
  let stopped = false;
  let entries = parseRecent(readBrowserCopy(STORAGE_KEY));

  const renderMenu = () => {
    disposers.forEach((dispose) => dispose());
    disposers = [];
    if (entries.length === 0) {
      disposers.push(MenuRegistry.appendMenuItem(MenuId.MenubarRecentZipMenu, {
        command: { id: "silkZip.recent.empty", title: "최근 압축 파일이 없습니다" },
        group: "1_recent",
        order: 1,
      }));
      disposers.push(CommandsRegistry.registerCommand("silkZip.recent.empty", () => undefined));
      return;
    }
    entries.forEach((path, index) => {
      const id = `silkZip.recent.open.${index}`;
      disposers.push(CommandsRegistry.registerCommand(id, () => openArchive(path)));
      disposers.push(MenuRegistry.appendMenuItem(MenuId.MenubarRecentZipMenu, {
        command: { id, title: `${index + 1}. ${archiveName(path)}` },
        group: "1_recent",
        order: index + 1,
      }));
    });
    const clearId = "silkZip.recent.clear";
    disposers.push(CommandsRegistry.registerCommand(clearId, () => {
      entries = [];
      writeStored("recent-archives", STORAGE_KEY, "[]");
      renderMenu();
    }));
    disposers.push(MenuRegistry.appendMenuItem(MenuId.MenubarRecentZipMenu, {
      command: { id: clearId, title: "최근 항목 지우기" },
      group: "2_clear",
      order: 1,
    }));
  };

  renderMenu();
  void syncStored("recent-archives", () => readBrowserCopy(STORAGE_KEY), (text) => { if (stopped) return; entries = parseRecent(text); renderMenu(); });
  return {
    record(path) {
      if (stopped) return;
      entries = [path, ...entries.filter((entry) => entry !== path)].slice(0, MAX_RECENT);
      writeStored("recent-archives", STORAGE_KEY, JSON.stringify(entries));
      renderMenu();
    },
    stop() { stopped = true; disposers.forEach((dispose) => dispose()); },
  };
}
