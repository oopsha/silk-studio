import { useSyncExternalStore } from "react";
import { readBrowserCopy, syncStored, writeStored } from "@silk-studio/workbench/services/storage/fileStore.ts";

/** How "압축 풀기" picks its destination when no folder is chosen explicitly. */
export type ExtractDefaultTarget = "ask" | "named" | "here";

export type ZipViewMode = "large-icons" | "icons" | "list" | "details";
export const ZIP_VIEW_MODES: readonly { id: ZipViewMode; title: string }[] = [
  { id: "large-icons", title: "큰 아이콘" },
  { id: "icons", title: "아이콘" },
  { id: "list", title: "목록" },
  { id: "details", title: "자세히" },
];

/** Columns of the opened archive's file list that can be switched on and off (보기 > 표시할 열). */
export const ZIP_COLUMNS = [
  { id: "packed", title: "압축 크기" },
  { id: "size", title: "원본 크기" },
  { id: "kind", title: "파일 종류" },
  { id: "modified", title: "수정한 날짜" },
  { id: "method", title: "압축 방식" },
  { id: "encryption", title: "암호 방식" },
  { id: "crc", title: "CRC" },
  { id: "attributes", title: "속성" },
] as const;
export type ZipColumnId = (typeof ZIP_COLUMNS)[number]["id"];
const DEFAULT_COLUMNS: readonly ZipColumnId[] = ["packed", "size", "kind", "modified"];

export type ExistingFilePolicy = "ask" | "skip" | "overwrite";

export interface ZipSettings {
  /** Shown columns, in the order of `ZIP_COLUMNS`. */
  visibleColumns: readonly ZipColumnId[];
  /** How the opened archive's files are laid out (보기 > 보기 형식). */
  viewMode: ZipViewMode;
  extractTarget: ExtractDefaultTarget;
  /** What happens to files that already exist in the destination. */
  existing: ExistingFilePolicy;
  /** Open the destination folder once extraction finishes. */
  openFolderAfter: boolean;
}

const STORAGE_KEY = "silkZip.settings";
const DEFAULTS: ZipSettings = { visibleColumns: DEFAULT_COLUMNS, viewMode: "details", extractTarget: "ask", existing: "ask", openFolderAfter: false };

/** Reads settings text; unknown or broken content falls back to the defaults. */
function parse(text: string | null): ZipSettings {
  try {
    const stored: unknown = JSON.parse(text ?? "{}");
    const value = (stored && typeof stored === "object" ? stored : {}) as Partial<ZipSettings>;
    return {
      visibleColumns: Array.isArray(value.visibleColumns)
        ? ZIP_COLUMNS.map((column) => column.id).filter((id) => (value.visibleColumns as unknown[]).includes(id))
        : DEFAULTS.visibleColumns,
      viewMode: ZIP_VIEW_MODES.some((mode) => mode.id === value.viewMode) ? (value.viewMode as ZipViewMode) : DEFAULTS.viewMode,
      extractTarget: value.extractTarget === "named" || value.extractTarget === "here" ? value.extractTarget : DEFAULTS.extractTarget,
      existing: value.existing === "ask" || value.existing === "skip" || value.existing === "overwrite"
        ? value.existing
        // Settings saved before "ask" existed stored a plain true/false; false was the untouched default.
        : (value as { overwrite?: unknown }).overwrite === true ? "overwrite" : DEFAULTS.existing,
      openFolderAfter: typeof value.openFolderAfter === "boolean" ? value.openFolderAfter : DEFAULTS.openFolderAfter,
    };
  } catch {
    return DEFAULTS;
  }
}

// The browser copy is the store in a plain browser and the migration source in the desktop app.
let current = parse(readBrowserCopy(STORAGE_KEY));
const listeners = new Set<() => void>();
void syncStored("settings", () => readBrowserCopy(STORAGE_KEY) ?? JSON.stringify(current), (text) => {
  current = parse(text);
  listeners.forEach((listener) => listener());
});

export function getZipSettings(): ZipSettings {
  return current;
}

export function updateZipSettings(patch: Partial<ZipSettings>): void {
  current = { ...current, ...patch };
  writeStored("settings", STORAGE_KEY, JSON.stringify(current));
  listeners.forEach((listener) => listener());
}

export function useZipSettings(): ZipSettings {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    getZipSettings,
  );
}

// A full-page view (settings, keyboard shortcuts) replaces the workbench area while open.
export type ZipPage = "settings" | "keybindings" | null;

let currentPage: ZipPage = null;
const pageListeners = new Set<() => void>();

export function setPage(page: ZipPage): void {
  if (currentPage === page) return;
  currentPage = page;
  pageListeners.forEach((listener) => listener());
}

export function usePage(): ZipPage {
  return useSyncExternalStore(
    (listener) => { pageListeners.add(listener); return () => pageListeners.delete(listener); },
    () => currentPage,
  );
}
