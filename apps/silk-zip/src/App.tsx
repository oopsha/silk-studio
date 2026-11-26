import { useEffect, useRef, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import ActivityBar from "@silk-studio/workbench/components/layout/ActivityBar/index.ts";
import type { ActivityViewContribution } from "@silk-studio/workbench/services/view/viewService.ts";
import { startWindowLayoutSync } from "@silk-studio/workbench/services/layout/windowLayoutSync.ts";
import TitleBar from "@silk-studio/workbench/components/layout/TitleBar/index.ts";
import Menubar from "@silk-studio/workbench/components/menubar/index.ts";
import { detectWorkbenchPlatform } from "@silk-studio/ui/platform/fonts.ts";
import "./activityBar";
import "./menubar";
import { CommandsRegistry } from "@silk-studio/workbench/platform/commands/commandRegistry.ts";
import { ContextKeyService } from "@silk-studio/workbench/platform/context/contextKeyService.ts";
import { KeybindingsRegistry } from "@silk-studio/workbench/platform/keybinding/keybindingRegistry.ts";
import AboutDialog from "@silk-studio/workbench/components/diagnostics/AboutDialog.tsx";
import { AboutDialogService } from "@silk-studio/workbench/services/diagnostics/aboutDialogService.ts";
import ConfirmDialog from "@silk-studio/workbench/components/dialogs/ConfirmDialog.tsx";
import { ConfirmDialogService } from "@silk-studio/workbench/services/dialog/confirmDialogService.ts";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { cancelArchive, createArchive, openInstallFolder, listArchive, openOutputFolder, revealInFolder, openNewWindow, exitApp, saveArchiveAs, clipboardPrepareDir, clipboardCopyDir, clipboardReadFiles, isElevated, reportArchiveProgressDiagnostic, takeLaunchRequest, uniquePath, type ArchiveListing, type CreateProgress, type CreateResult } from "./archive";
import { startNativeMenubar } from "@silk-studio/workbench/services/nativeMenubar/nativeMenubarService.ts";
import CommandPalette from "@silk-studio/workbench/components/commands/index.ts";
import ZipSettingsPage from "./components/ZipSettingsPage";
import ZipKeybindingsPage from "./components/ZipKeybindingsPage";
import { HistoryService } from "@silk-studio/editor/services/history/historyService.ts";
import { UserKeybindingsService } from "@silk-studio/workbench/platform/keybinding/userKeybindingsService.ts";
import { getZipSettings, setPage, updateZipSettings, useZipSettings, usePage, ZIP_COLUMNS, ZIP_VIEW_MODES, type ZipPage } from "./zipSettings";
import ArchiveExplorer, { type RenameEntry } from "./components/ArchiveExplorer";
import { findDropFolder, highlightDropTarget } from "./dropTarget";
import { FOCUS_SEARCH_EVENT } from "./components/ArchiveSearchView";
import { ViewService } from "@silk-studio/workbench/services/view/viewService.ts";
import { LayoutService } from "@silk-studio/workbench/services/layout/layoutService.ts";
import RenameDialog from "./components/RenameDialog";
import { siblingNames } from "./archiveSource";
import { usePendingChanges } from "./pendingChanges";
import CommandBar from "./components/CommandBar";
import { ExtractDialog, useExtraction } from "./components/ExtractDialog";
import { useCompressionDraft } from "./components/useCompressionDraft";
import { startRecentArchives } from "./recentArchives";
import { archiveStem, joinPath, parentFolder, type ExtractTarget } from "./extractTargets";
import { quickArchivePath } from "./launchRequest";

/** The icon toolbar under the menu bar is kept but hidden; extraction lives in the explorer title row. */
const SHOW_COMMAND_BAR = false;

const ARCHIVE_FILE_FILTERS = [
  { name: "압축 파일", extensions: ["zip", "zipx", "tar", "tgz", "taz", "gz", "gzip", "bz2", "xz", "txz", "lz", "lzma", "lzh", "lha", "iso", "7z", "zpaq", "rar", "rar5"] },
  { name: "모든 파일", extensions: ["*"] },
];

const activityViews: readonly ActivityViewContribution[] = [
  { id: "explorer", icon: "files", label: "탐색기", render: () => null },
  { id: "search", icon: "search", label: "검색", render: () => null },
];

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toLocaleString("ko-KR", { maximumFractionDigits: 1 })} ${units[unit]}`;
}

function formatElapsedTime(elapsedMs: number): string {
  const totalTenths = Math.round(elapsedMs / 100);
  const minutes = Math.floor(totalTenths / 600);
  const seconds = ((totalTenths % 600) / 10).toFixed(1);
  return minutes > 0 ? `${minutes}분 ${seconds}초` : `${seconds}초`;
}

function App() {
  const { viewMode, visibleColumns } = useZipSettings();
  useEffect(() => startWindowLayoutSync(), []);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [format, setFormat] = useState("zip");
  const [outputPath, setOutputPath] = useState("새 압축.zip");
  const draft = useCompressionDraft(outputPath.split(/[\\/]/).pop() || "새 압축.zip");
  const files = draft.entries.map((entry) => entry.archivePath);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [splitSize, setSplitSize] = useState("none");
  const [customSplitSize, setCustomSplitSize] = useState("100");
  const [compressionMethod, setCompressionMethod] = useState("normal");
  const [outputConfirmed, setOutputConfirmed] = useState(false);
  // A one-click compression asked for from outside (Explorer menu); it starts once the items are scanned.
  const [quickCompress, setQuickCompress] = useState<{ paths: string[]; extension: "zip" | "7z" } | null>(null);
  const [preparationMessage, setPreparationMessage] = useState("");
  const [compressionProgress, setCompressionProgress] = useState<CreateProgress | null>(null);
  const [compressionError, setCompressionError] = useState<string | null>(null);
  const [cancelRequested, setCancelRequested] = useState(false);
  const [completedArchive, setCompletedArchive] = useState<(CreateResult & { elapsedMs: number }) | null>(null);
  const [archive, setArchive] = useState<ArchiveListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elevated, setElevated] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ entry: RenameEntry; siblings: string[]; inArchive: boolean } | null>(null);
  const archiveSelection = useRef<RenameEntry | null>(null);
  const folderRef = useRef("");
  const selectedPathsRef = useRef<string[]>([]);
  const pending = usePendingChanges(archive);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  // Edit commands act on the opened archive, or on the new archive while none is open.
  const activeRef = useRef(pending);
  activeRef.current = archive ? pending : draft.pending;
  const [folderPrompt, setFolderPrompt] = useState<{ folder: string; siblings: string[] } | null>(null);
  const addActions = useRef({ files: () => {}, folder: () => {}, paste: () => {}, copy: () => {}, addPaths: async (_paths: string[], _folder: string) => {} });
  const page = usePage();
  const pageRef = useRef(page);
  pageRef.current = page;
  const [settingsOpen, setSettingsOpen] = useState(true);
  const busy = useRef(false);
  const creating = useRef(false);
  const activeCreateId = useRef<string | null>(null);
  const extractionController = useExtraction();
  const extraction = useRef(extractionController);
  extraction.current = extractionController;
  const createDraft = useRef({ archive, files, format, outputPath, password, confirmPassword, splitSize, customSplitSize, compressionMethod, outputConfirmed, preparationMessage, resetDraft: draft.reset });
  createDraft.current = { archive, files, format, outputPath, password, confirmPassword, splitSize, customSplitSize, compressionMethod, outputConfirmed, preparationMessage, resetDraft: draft.reset };

  useEffect(() => {
    if (!addMenuOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!addMenuRef.current?.contains(event.target as Node)) setAddMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAddMenuOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [addMenuOpen]);

  useEffect(() => { if (isTauri()) void isElevated().then(setElevated).catch(() => undefined); }, []);

  // macOS: the shared title bar has no in-window menu, so install the system menu bar.
  useEffect(() => startNativeMenubar({ appName: "Silk Zip" }), []);

  useEffect(() => {
    if (!page) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setPage(null); };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [page]);

  // Navigation history: every screen (create form, open archive, settings pages) is a location.
  useEffect(() => {
    const uri = page ? `zip:page:${page}` : archive ? `zip:archive:${archive.path}` : "zip:create";
    if ((HistoryService.current()?.uri ?? "zip:create") === uri) return;
    const name = archive?.path.split(/[\/]/).pop() ?? "";
    HistoryService.push({ uri, label: page === "settings" ? "설정" : page === "keybindings" ? "키보드 단축키" : archive ? name : "새 압축 만들기" });
  }, [archive, page]);

  // Suppress the browser's own context menu; text fields keep it for copy/paste.
  useEffect(() => {
    const block = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      event.preventDefault();
    };
    document.addEventListener("contextmenu", block);
    return () => document.removeEventListener("contextmenu", block);
  }, []);

  useEffect(() => {
    ContextKeyService.set("canAddEntries", page === null && (archive ? pending.editable : compressionProgress === null));
  }, [archive, page, compressionProgress, pending.editable]);

  useEffect(() => {
    for (const mode of ZIP_VIEW_MODES) ContextKeyService.set(`silkZip.viewMode.${mode.id}`, viewMode === mode.id);
  }, [viewMode]);

  useEffect(() => {
    for (const column of ZIP_COLUMNS) ContextKeyService.set(`silkZip.column.${column.id}`, visibleColumns.includes(column.id));
  }, [visibleColumns]);

  useEffect(() => {
    ContextKeyService.set("hasOpenArchive", archive !== null);
    ContextKeyService.set("hasArchiveEntrySelection", false);
  }, [archive]);

  // Files dropped on the window are added to the shown folder; a folder row or tree item under the pointer wins.
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    const locate = (position: { x: number; y: number }) => findDropFolder(position, activeRef.current.view, folderRef.current);
    void getCurrentWebview().onDragDropEvent((event) => {
      const payload = event.payload;
      if (pageRef.current !== null) return;
      if (payload.type === "enter" || payload.type === "over") {
        setDragActive(true);
        highlightDropTarget(locate(payload.position).element);
      } else if (payload.type === "leave") {
        setDragActive(false);
        highlightDropTarget(null);
      } else if (payload.type === "drop") {
        setDragActive(false);
        const { folder } = locate(payload.position);
        highlightDropTarget(null);
        const paths = payload.paths ?? [];
        if (!paths.length || creating.current) return;
        if (!activeRef.current.editable) { setError("이 형식의 압축 파일은 수정할 수 없습니다. (zip, 7z, tar만 가능)"); return; }
        void addActions.current.addPaths(paths, folder);
      }
    }).then((stop) => {
      if (cancelled) stop();
      else unlisten = stop;
    }).catch((reason) => console.warn("[silkZip.fileDrop] 드롭 이벤트 연결 실패:", reason));
    return () => { cancelled = true; setDragActive(false); highlightDropTarget(null); unlisten?.(); };
  }, []);

  const recentRef = useRef<ReturnType<typeof startRecentArchives> | null>(null);
  const openPathRef = useRef<(path: string) => Promise<void>>(async () => {});
  // The recent list follows use: whichever way an archive gets opened, it moves to the top.
  useEffect(() => { if (archive) recentRef.current?.record(archive.path); }, [archive?.path]);

  useEffect(() => {
    let disposed = false;
    const openPath = async (path: string) => {
      if (busy.current) return;
      if (!(await confirmDiscard())) return;
      busy.current = true;
      try {
        setLoading(true);
        setError(null);
        const result = await listArchive(path);
        if (!disposed) setArchive(result);
      } catch (reason) {
        if (!disposed) setError(String(reason));
      } finally {
        busy.current = false;
        if (!disposed) setLoading(false);
      }
    };
    openPathRef.current = openPath;
    const recentArchives = startRecentArchives(openPath);
    recentRef.current = recentArchives;
    const confirmDiscard = async (): Promise<boolean> => {
      if (!pendingRef.current.dirty) return true;
      return ConfirmDialogService.confirm({
        title: "변경 사항이 적용되지 않았습니다",
        message: `대기 중인 변경 ${pendingRef.current.count.toLocaleString()}개가 압축 파일에 아직 반영되지 않았습니다. 버리고 계속할까요?`,
        confirmLabel: "버리고 계속",
        cancelLabel: "취소",
        danger: true,
      });
    };
    const openArchive = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        const path = await open({ multiple: false, directory: false, filters: ARCHIVE_FILE_FILTERS });
        if (disposed || !path || Array.isArray(path)) return;
        if (!(await confirmDiscard())) return;
        setLoading(true);
        setError(null);
        const result = await listArchive(path);
        if (!disposed) setArchive(result);
      } catch (reason) {
        if (!disposed) setError(String(reason));
      } finally {
        busy.current = false;
        if (!disposed) setLoading(false);
      }
    };
    const newArchive = async () => {
      if (creating.current) return;
      if (!(await confirmDiscard())) return;
      const draft = createDraft.current;
      const hasUnsavedWork = draft.files.length > 0
        || draft.format !== "zip"
        || draft.outputPath !== "새 압축.zip"
        || draft.password !== ""
        || draft.confirmPassword !== ""
        || draft.splitSize !== "none"
        || draft.compressionMethod !== "normal"
        || draft.outputConfirmed;
      if (draft.archive === null && hasUnsavedWork) {
        const confirmed = await ConfirmDialogService.confirm({
          title: "새 압축",
          message: "현재 작업은 저장되지 않습니다. 새 압축을 시작할까요?",
          confirmLabel: "새 압축",
          cancelLabel: "취소",
        });
        if (!confirmed) return;
      }
      setArchive(null);
      setError(null);
      draft.resetDraft();
      setFormat("zip");
      setOutputPath("새 압축.zip");
      setPassword("");
      setConfirmPassword("");
      setShowPassword(false);
      setSplitSize("none");
      setCustomSplitSize("100");
      setCompressionMethod("normal");
      setOutputConfirmed(false);
      setPreparationMessage("");
      setCompletedArchive(null);
    };
    const extractCurrentArchive = (target: ExtractTarget) => () => {
      const current = createDraft.current.archive;
      if (current) void extraction.current.start(current.path, target);
    };
    const closeArchive = async () => {
      if (!createDraft.current.archive || busy.current) return;
      if (!(await confirmDiscard())) return;
      setArchive(null);
      setError(null);
    };
    const openArchiveFolder = async () => {
      const current = createDraft.current.archive;
      if (!current) return;
      try { await revealInFolder(current.path); }
      catch (reason) { setError(String(reason)); }
    };
    const unregisterOpenFolder = CommandsRegistry.registerCommand("silkZip.file.openFolder", openArchiveFolder);
    const unregisterTest = CommandsRegistry.registerCommand("silkZip.file.test", () => {
      const current = createDraft.current.archive;
      if (current) void extraction.current.startTest(current.path);
    });
    const unregisterTestKey = KeybindingsRegistry.registerKeybinding("silkZip.file.test", detectWorkbenchPlatform() === "mac" ? "Cmd+T" : "Ctrl+T");
    const newWindow = (admin: boolean) => async () => {
      try { await openNewWindow(admin); }
      catch (reason) { setError(String(reason)); }
    };
    const unregisterNewWindow = CommandsRegistry.registerCommand("silkZip.file.newFolder", newWindow(false));
    const unregisterNewWindowAdmin = CommandsRegistry.registerCommand("silkZip.file.newFolderAdmin", newWindow(true));
    const unregisterNewWindowKeys = [
      KeybindingsRegistry.registerKeybinding("silkZip.file.newFolder", detectWorkbenchPlatform() === "mac" ? "Cmd+Shift+N" : "Ctrl+Shift+N"),
      ...(detectWorkbenchPlatform() === "windows" ? [KeybindingsRegistry.registerKeybinding("silkZip.file.newFolderAdmin", "Ctrl+Alt+N")] : []),
    ];
    const saveArchiveCopy = async () => {
      const current = createDraft.current.archive;
      if (!current) return;
      const extension = /\.([^.\\/]+)$/.exec(current.path)?.[1];
      const target = await save({
        defaultPath: current.path,
        filters: extension ? [{ name: extension.toUpperCase(), extensions: [extension] }, { name: "모든 파일", extensions: ["*"] }] : undefined,
      });
      if (!target) return;
      try {
        await saveArchiveAs(current.path, target);
        const openSaved = await ConfirmDialogService.confirm({ title: "다른 이름으로 저장", message: `저장했습니다.
${target}

저장한 파일을 열까요?`, confirmLabel: "열기", cancelLabel: "닫기" });
        if (openSaved && !busy.current) {
          busy.current = true;
          try {
            setLoading(true);
            setError(null);
            const result = await listArchive(target);
            if (!disposed) setArchive(result);
          } catch (reason) {
            if (!disposed) setError(String(reason));
          } finally {
            busy.current = false;
            if (!disposed) setLoading(false);
          }
        }
      } catch (reason) {
        await ConfirmDialogService.confirm({ title: "저장 실패", message: String(reason), confirmLabel: "확인", hideCancel: true });
      }
    };
    const unregisterSaveAs = CommandsRegistry.registerCommand("silkZip.file.saveAs", saveArchiveCopy);
    const quit = async () => {
      if (!(await confirmDiscard())) return;
      const busyNow = creating.current || extraction.current.state?.phase === "running";
      if (busyNow) {
        const confirmed = await ConfirmDialogService.confirm({
          title: "종료",
          message: "작업이 진행 중입니다. 지금 종료하면 작업이 중단됩니다. 종료할까요?",
          confirmLabel: "종료",
          cancelLabel: "취소",
          danger: true,
        });
        if (!confirmed) return;
      }
      try { await exitApp(); }
      catch (reason) { setError(String(reason)); }
    };
    const unregisterExit = CommandsRegistry.registerCommand("silkZip.file.exit", quit);
    const unregisterExitKey = KeybindingsRegistry.registerKeybinding("silkZip.file.exit", detectWorkbenchPlatform() === "mac" ? "Cmd+W" : "Ctrl+W");
    const unregisterAdd = [
      CommandsRegistry.registerCommand("silkZip.edit.addFiles", () => addActions.current.files()),
      CommandsRegistry.registerCommand("silkZip.edit.addFolder", () => addActions.current.folder()),
      KeybindingsRegistry.registerKeybinding("silkZip.edit.addFiles", "Insert"),
      CommandsRegistry.registerCommand("silkZip.edit.find", () => {
        // Opens the search view; when it is already shown, only moves focus to its input.
        if (ViewService.getActiveViewId() !== "search" || !LayoutService.isSidebarVisible()) ViewService.openView("search");
        setTimeout(() => window.dispatchEvent(new Event(FOCUS_SEARCH_EVENT)), 0);
      }),
      KeybindingsRegistry.registerKeybinding("silkZip.edit.find", "Ctrl+F"),
      KeybindingsRegistry.registerKeybinding("silkZip.edit.find", "Ctrl+Shift+F"),
      CommandsRegistry.registerCommand("silkZip.help.openInstallFolder", () => { void openInstallFolder().catch((error) => ConfirmDialogService.confirm({ title: "설치 위치를 열지 못했습니다", message: String(error), confirmLabel: "확인", hideCancel: true })); }),
      CommandsRegistry.registerCommand("silkZip.help.about", () => AboutDialogService.show()),
      KeybindingsRegistry.registerKeybinding("silkZip.help.about", "F1"),
      CommandsRegistry.registerCommand("silkZip.tools.repair", async () => {
        if (busy.current || extraction.current.state !== null) return;
        const source = await open({ multiple: false, directory: false, title: "복구할 압축 파일 선택", filters: ARCHIVE_FILE_FILTERS });
        if (!source || Array.isArray(source)) return;
        const folder = parentFolder(source);
        const target = await save({
          title: "복구한 압축 파일 저장",
          defaultPath: folder ? joinPath(folder, `${archiveStem(source)}_복구.zip`) : `${archiveStem(source)}_복구.zip`,
          filters: [{ name: "ZIP", extensions: ["zip"] }, { name: "7z", extensions: ["7z"] }],
        });
        if (!target) return;
        void extraction.current.startRepair(source, target, (path) => { void openPathRef.current(path); });
      }),
      ...ZIP_COLUMNS.map((column) => CommandsRegistry.registerCommand(`silkZip.column.${column.id}`, () => {
        const current = getZipSettings().visibleColumns;
        const next = current.includes(column.id) ? current.filter((id) => id !== column.id) : [...current, column.id];
        updateZipSettings({ visibleColumns: ZIP_COLUMNS.map((item) => item.id).filter((id) => next.includes(id)) });
      })),
      ...ZIP_VIEW_MODES.map((mode) => CommandsRegistry.registerCommand(`silkZip.viewMode.${mode.id}`, () => updateZipSettings({ viewMode: mode.id }))),
      CommandsRegistry.registerCommand("silkZip.edit.copy", () => addActions.current.copy()),
      KeybindingsRegistry.registerKeybinding("silkZip.edit.copy", "Ctrl+C"),
      CommandsRegistry.registerCommand("silkZip.edit.paste", () => addActions.current.paste()),
      KeybindingsRegistry.registerKeybinding("silkZip.edit.paste", "Ctrl+V"),
    ];
    const removeSelected = () => {
      const active = activeRef.current;
      if (active.editable && selectedPathsRef.current.length) active.remove(selectedPathsRef.current);
    };
    const unregisterDelete = [
      CommandsRegistry.registerCommand("silkZip.edit.delete", removeSelected),
      KeybindingsRegistry.registerKeybinding("silkZip.edit.delete", "Delete"),
    ];
    const unregisterRename = CommandsRegistry.registerCommand("silkZip.edit.rename", () => {
      const active = activeRef.current;
      const entry = archiveSelection.current;
      if (entry && active.editable && active.view) setRenameTarget({ entry, siblings: siblingNames(active.view, entry.path), inArchive: true });
    });
    const unregisterRenameKey = KeybindingsRegistry.registerKeybinding("silkZip.edit.rename", "F2");
    const unregisterClose = CommandsRegistry.registerCommand("silkZip.file.closeArchive", closeArchive);
    const unregisterCloseKey = KeybindingsRegistry.registerKeybinding("silkZip.file.closeArchive", "F4");
    const unregisterExtract = CommandsRegistry.registerCommand("silkZip.file.extract", () => extractCurrentArchive(getZipSettings().extractTarget)());
    const openSettings = () => setPage("settings");
    const restoreLocation = async () => {
      const uri = HistoryService.current()?.uri ?? "zip:create";
      if (uri === "zip:create") { setArchive(null); setPage(null); return; }
      if (uri.startsWith("zip:page:")) { setPage(uri.slice("zip:page:".length) as ZipPage); return; }
      const path = uri.slice("zip:archive:".length);
      if (createDraft.current.archive?.path === path) { setPage(null); return; }
      try {
        setLoading(true);
        setError(null);
        const result = await listArchive(path);
        setArchive(result);
        setPage(null);
      } catch (reason) {
        setError(String(reason));
      } finally {
        setLoading(false);
      }
    };
    const stopHistory = HistoryService.onDidChange(() => { void restoreLocation(); });
    const unregisterSettings = [
      CommandsRegistry.registerCommand("workbench.action.openSettings", openSettings),
      KeybindingsRegistry.registerKeybinding("workbench.action.openSettings", "Ctrl+,"),
      CommandsRegistry.registerCommand("workbench.action.navigateBack", () => HistoryService.goBack()),
      CommandsRegistry.registerCommand("workbench.action.navigateForward", () => HistoryService.goForward()),
      KeybindingsRegistry.registerKeybinding("workbench.action.navigateBack", "Alt+Left"),
      KeybindingsRegistry.registerKeybinding("workbench.action.navigateForward", "Alt+Right"),
      CommandsRegistry.registerCommand("workbench.action.openGlobalKeybindings", () => setPage("keybindings")),
      KeybindingsRegistry.registerKeybinding("workbench.action.openGlobalKeybindings", "Ctrl+K Ctrl+S"),
    ];
    const unregisterExtractHere = CommandsRegistry.registerCommand("silkZip.file.extractHere", extractCurrentArchive("here"));
    const unregisterExtractNamed = CommandsRegistry.registerCommand("silkZip.file.extractNamed", extractCurrentArchive("named"));
    const mac = detectWorkbenchPlatform() === "mac";
    const unregisterExtractKeys = [
      KeybindingsRegistry.registerKeybinding("silkZip.file.extract", mac ? "Cmd+E" : "Ctrl+E"),
      KeybindingsRegistry.registerKeybinding("silkZip.file.extractHere", mac ? "Cmd+Shift+C" : "Ctrl+Shift+C"),
      KeybindingsRegistry.registerKeybinding("silkZip.file.extractNamed", mac ? "Cmd+Shift+S" : "Ctrl+Shift+S"),
    ];
    const unregister = CommandsRegistry.registerCommand("silkZip.file.openArchive", openArchive);
    const unregisterNew = CommandsRegistry.registerCommand("silkZip.file.newArchive", newArchive);
    const unregisterKey = KeybindingsRegistry.registerKeybinding("silkZip.file.openArchive", detectWorkbenchPlatform() === "mac" ? "Cmd+O" : "Ctrl+O");
    const unregisterNewKey = KeybindingsRegistry.registerKeybinding("silkZip.file.newArchive", detectWorkbenchPlatform() === "mac" ? "Cmd+N" : "Ctrl+N");
    // Re-apply the user's shortcut changes now that every default is registered.
    UserKeybindingsService.reapply();
    const onKeyDown = (event: KeyboardEvent) => { KeybindingsRegistry.handleKeyboardEvent(event); };
    window.addEventListener("keydown", onKeyDown);
    return () => { disposed = true; recentArchives.stop(); unregisterNewKey(); unregisterNew(); unregisterDelete.forEach((stop) => stop()); unregisterAdd.forEach((stop) => stop()); unregisterSaveAs(); unregisterRename(); unregisterRenameKey(); unregisterExit(); unregisterExitKey(); stopHistory(); unregisterSettings.forEach((stop) => stop()); unregisterNewWindow(); unregisterNewWindowAdmin(); unregisterNewWindowKeys.forEach((stop) => stop()); unregisterTest(); unregisterTestKey(); unregisterOpenFolder(); unregisterClose(); unregisterCloseKey(); unregisterExtract(); unregisterExtractHere(); unregisterExtractNamed(); unregisterExtractKeys.forEach((stop) => stop()); unregisterKey(); unregister(); window.removeEventListener("keydown", onKeyDown); };
  }, []);
  const addToArchive = async (paths: string[], folder: string = folderRef.current) => {
    try {
      const message = archive ? await pending.add(paths, folder) : await draft.add(paths, folder);
      if (message) setError(message);
    } catch (reason) {
      setError(String(reason));
    }
  };
  const addFiles = async () => {
    setAddMenuOpen(false);
    const selected = await open({ multiple: true, directory: false });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    await addToArchive(paths);
  };
  /** Selected archive entries go to the clipboard as real files (extracted into a temporary folder). */
  const copyToClipboard = async () => {
    if (!archive || page !== null || !selectedPathsRef.current.length) return;
    try {
      const dir = await clipboardPrepareDir();
      await extractionController.startCopy(archive.path, dir, selectedPathsRef.current, () => {
        clipboardCopyDir(dir).catch((reason) => setError(String(reason)));
      });
    } catch (reason) {
      setError(String(reason));
    }
  };
  /** Files on the clipboard are added like dropped files. */
  const pasteFromClipboard = async () => {
    if (page !== null) return;
    if (archive && !pending.editable) { setError("이 형식의 압축 파일은 수정할 수 없습니다. (zip, 7z, tar만 가능)"); return; }
    try {
      const paths = await clipboardReadFiles();
      if (!paths.length) { setError("클립보드에 붙여넣을 파일이 없습니다."); return; }
      await addToArchive(paths);
    } catch (reason) {
      setError(String(reason));
    }
  };
  addActions.current = { files: () => { void addFiles(); }, folder: () => { void addFolder(); }, paste: () => { void pasteFromClipboard(); }, copy: () => { void copyToClipboard(); }, addPaths: addToArchive };
  const addFolder = async () => {
    setAddMenuOpen(false);
    const selected = await open({ multiple: true, directory: true });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    await addToArchive(paths);
  };
  const applyPending = () => {
    if (!archive) return;
    const archivePath = archive.path;
    const { changes, adds } = pending.request();
    void extractionController.startUpdate(archivePath, changes, adds, () => {
      void listArchive(archivePath).then((result) => { setArchive(result); setError(null); }).catch((reason) => setError(String(reason)));
    });
  };
  const chooseOutputPath = async (): Promise<string | null> => {
    const selected = await save({
      defaultPath: outputPath,
      filters: [{ name: format.toUpperCase(), extensions: [format] }],
    });
    if (selected) {
      setOutputPath(selected);
      setOutputConfirmed(true);
      setPreparationMessage("");
      return selected;
    }
    return null;
  };
  const runCompression = async (destination: string) => {
    const operationId = crypto.randomUUID();
    creating.current = true;
    activeCreateId.current = operationId;
    setCancelRequested(false);
    setCompressionError(null);
    setCompressionProgress({ phase: "writing", completedBytes: 0, totalBytes: draft.entries.reduce((total, entry) => total + (entry.size ?? 0), 0), completedEntries: 0, totalEntries: files.length });
    setPreparationMessage("");
    const compressionLevel = compressionMethod === "fast" ? 1 : compressionMethod === "maximum" ? 9 : 6;
    const progressDiagnostics = {
      receivedCount: 0,
      reportedCount: 0,
      lastReportedAt: performance.now(),
      lastMessageAt: performance.now(),
      latest: { completedBytes: 0, totalBytes: 0, completedEntries: 0, totalEntries: files.length },
      reporting: false,
    };
    const reportProgressDiagnostic = async () => {
      if (progressDiagnostics.reporting) return;
      progressDiagnostics.reporting = true;
      const now = performance.now();
      const receivedSinceLastSample = progressDiagnostics.receivedCount - progressDiagnostics.reportedCount;
      const sampleIntervalMs = Math.max(1, Math.round(now - progressDiagnostics.lastReportedAt));
      progressDiagnostics.reportedCount = progressDiagnostics.receivedCount;
      progressDiagnostics.lastReportedAt = now;
      const latest = progressDiagnostics.latest;
      try {
        await reportArchiveProgressDiagnostic(operationId, {
          receivedCount: progressDiagnostics.receivedCount,
          receivedSinceLastSample,
          sampleIntervalMs,
          ...latest,
          lastMessageAgeMs: Math.max(0, Math.round(now - progressDiagnostics.lastMessageAt)),
        });
      } catch {
        // Diagnostics must not interrupt archive creation.
      } finally {
        progressDiagnostics.reporting = false;
      }
    };
    const diagnosticTimer = window.setInterval(() => { void reportProgressDiagnostic(); }, 1000);
    try {
      const splitSizeMb = splitSize === "none"
        ? null
        : splitSize === "custom"
          ? Number(customSplitSize)
          : Number(splitSize);
      const splitSizeBytes = splitSizeMb === null ? null : splitSizeMb * 1024 * 1024;
      const inputEntrySizes = draft.entries.map((entry) => entry.directory ? 0 : entry.size ?? 0);
      const compressionStartedAt = performance.now();
      const result = await createArchive(operationId, draft.entries, inputEntrySizes, destination, format, compressionLevel, (format === "zip" || format === "7z") ? password : "", (format === "zip" || format === "7z") ? splitSizeBytes : null, (progress) => {
        progressDiagnostics.receivedCount += 1;
        progressDiagnostics.lastMessageAt = performance.now();
        progressDiagnostics.latest = {
          completedBytes: progress.completedBytes,
          totalBytes: progress.totalBytes,
          completedEntries: progress.completedEntries,
          totalEntries: progress.totalEntries,
        };
        setCompressionProgress(progress);
      });
      setCompletedArchive({ ...result, elapsedMs: performance.now() - compressionStartedAt });
      setOutputConfirmed(false);
    } catch (reason) {
      const message = String(reason);
      if (message.includes("취소")) setPreparationMessage("압축 작업을 취소했습니다.");
      else setCompressionError(message);
    } finally {
      window.clearInterval(diagnosticTimer);
      void reportProgressDiagnostic();
      creating.current = false;
      activeCreateId.current = null;
      setCompressionProgress(null);
      setCancelRequested(false);
    }
  };
  const prepareCompression = async () => {
    if (files.length === 0) return;
    if (!["zip", "tar", "gz", "tgz", "xz", "7z"].includes(format)) {
      setPreparationMessage("현재 압축 생성은 ZIP, TAR, GZ, TGZ, XZ, 7z 형식만 지원합니다.");
      return;
    }
    if ((format === "gz" || format === "xz") && (draft.entries.length !== 1 || draft.entries[0].directory)) {
      await ConfirmDialogService.confirm({
        title: `${format.toUpperCase()} 압축`,
        message: `${format.toUpperCase()}는 파일 하나만 압축할 수 있습니다. 여러 파일이나 폴더는 TGZ 또는 TAR을 사용하세요.`,
        confirmLabel: "확인",
        hideCancel: true,
      });
      return;
    }
    if (splitSize !== "none") {
      const splitSizeMb = splitSize === "custom" ? Number(customSplitSize) : Number(splitSize);
      if (!Number.isSafeInteger(splitSizeMb) || splitSizeMb < 1 || !Number.isSafeInteger(splitSizeMb * 1024 * 1024)) {
        setPreparationMessage("분할 크기는 1MB 이상의 정수로 입력하세요.");
        return;
      }
    }
    if (password !== confirmPassword) {
      setPreparationMessage("암호가 일치하는지 확인하세요.");
      return;
    }
    setPreparationMessage("");
    let destination = outputPath;
    if (!outputConfirmed) {
      const selected = await chooseOutputPath();
      if (!selected) return;
      destination = selected;
    }
    await runCompression(destination);
  };
  useEffect(() => {
    if (!quickCompress || draft.scanning || draft.entries.length === 0) return;
    const { paths, extension } = quickCompress;
    setQuickCompress(null);
    setFormat(extension);
    const wanted = quickArchivePath(paths, extension, draft.entries[0]?.directory === true && paths.length === 1);
    // Never write over (or into) something that exists, e.g. compressing "a.zip" beside itself.
    void uniquePath(wanted).catch(() => wanted).then((output) => {
      setOutputPath(output);
      setOutputConfirmed(true);
      setStartQuick(true);
    });
  }, [quickCompress, draft.scanning, draft.entries]);
  const [startQuick, setStartQuick] = useState(false);
  useEffect(() => {
    if (!startQuick) return;
    setStartQuick(false);
    void prepareCompression();
  }, [startQuick]);
  // Quick mode (a one-shot Explorer job): only the progress/result dialog shows, and the app
  // quits once that dialog has been dismissed.
  const [quickMode, setQuickMode] = useState(false);
  const quickSeen = useRef(false);
  // "Compress each": the items still waiting after the one being compressed.
  const [eachQueue, setEachQueue] = useState<string[]>([]);
  const [eachRunning, setEachRunning] = useState(false);
  useEffect(() => {
    if (!eachRunning) return;
    if (compressionError) { setEachRunning(false); return; }
    if (!completedArchive) return;
    if (eachQueue.length === 0) { setEachRunning(false); return; }
    const [next, ...rest] = eachQueue;
    setEachQueue(rest);
    setCompletedArchive(null);
    draft.reset();
    setOutputConfirmed(false);
    void draft.add([next]).then(() => setQuickCompress({ paths: [next], extension: "zip" }));
  }, [eachRunning, eachQueue, completedArchive, compressionError]);
  const quickDialogOpen = eachRunning || extractionController.state !== null ||compressionProgress !== null || completedArchive !== null || compressionError !== null;
  useEffect(() => {
    if (!quickMode) return;
    if (quickDialogOpen) { quickSeen.current = true; return; }
    if (!quickSeen.current) return;
    const timer = window.setTimeout(() => { void exitApp(); }, 400);
    return () => window.clearTimeout(timer);
  }, [quickMode, quickDialogOpen]);
  // The "file already exists" question needs more room than the small job window has.
  const quickConflict = extractionController.state?.phase === "conflict";
  useEffect(() => {
    if (!quickMode) return;
    const window = getCurrentWindow();
    void window.setSize(quickConflict ? new LogicalSize(520, 440) : new LogicalSize(460, 230)).then(() => window.center()).catch(() => undefined);
  }, [quickMode, quickConflict]);
  // Started from an Explorer/Finder menu: do what was asked with the given paths.
  useEffect(() => {
    let cancelled = false;
    void takeLaunchRequest().then(async (request) => {
      if (cancelled || !request) return;
      const { action, paths } = request;
      if (action === "extract-here" || action === "extract-folder" || action === "compress-zip" || action === "compress-7z" || action === "compress-each") setQuickMode(true);
      if (action === "compress-each") {
        // One archive per selected item: start with the first, the rest follow one by one.
        setEachQueue(paths.slice(1));
        setEachRunning(true);
        await draft.add([paths[0]]);
        setQuickCompress({ paths: [paths[0]], extension: "zip" });
        return;
      }
      if (action === "open") { await openPathRef.current(paths[0]); return; }
      if (action === "extract-here" || action === "extract-folder" || action === "extract-dialog") {
        const target: ExtractTarget = action === "extract-here" ? "here" : action === "extract-folder" ? "named" : "ask";
        for (const path of paths) await extraction.current.start(path, target);
        return;
      }
      if (action === "compress-zip" || action === "compress-7z" || action === "compress-dialog") {
        await draft.add(paths);
        if (action !== "compress-dialog") setQuickCompress({ paths, extension: action === "compress-7z" ? "7z" : "zip" });
      }
    }).catch((reason) => console.warn("[silkZip.launch] 시작 요청 처리 실패:", reason));
    return () => { cancelled = true; };
  }, []);
  const cancelCompression = async () => {
    const operationId = activeCreateId.current;
    if (!operationId || cancelRequested) return;
    setCancelRequested(true);
    try {
      const accepted = await cancelArchive(operationId);
      if (!accepted) setCancelRequested(false);
    }
    catch (reason) { setPreparationMessage(`취소 요청을 전달하지 못했습니다: ${String(reason)}`); setCancelRequested(false); }
  };
  const openCompletedArchive = async () => {
    if (!completedArchive) return;
    try {
      const listing = await listArchive(completedArchive.path);
      setArchive(listing);
      setCompletedArchive(null);
    } catch (reason) {
      setCompletedArchive(null);
      setError(String(reason));
    }
  };
  const openCompletedFolder = async () => {
    if (!completedArchive) return;
    try { await openOutputFolder(completedArchive.path); }
    catch (reason) { setCompletedArchive(null); setError(String(reason)); }
  };
  const methods = format === "tar"
    ? [{ value: "store", label: "압축 안 함" }]
    : [
        { value: "fast", label: "빠름" },
        { value: "normal", label: "보통" },
        { value: "maximum", label: "최대" },
      ];
  const progressPercent = compressionProgress
    ? compressionProgress.phase === "preparing"
      ? 0
      : compressionProgress.phase === "finalizing"
      ? 100
      : compressionProgress.totalBytes > 0
        ? Math.min(99, Math.floor(compressionProgress.completedBytes / compressionProgress.totalBytes * 100))
        : compressionProgress.totalEntries > 0
          ? Math.min(99, Math.floor(compressionProgress.completedEntries / compressionProgress.totalEntries * 100))
          : 0
    : 0;

  const settingsPanel = (
    <div className="zip-create-form zip-draft-settings">
      <button type="button" className="zip-draft-settings__summary" aria-expanded={settingsOpen} onClick={() => setSettingsOpen((open) => !open)}>
        <span className="codicon codicon-chevron-down zip-draft-settings__chevron" data-open={settingsOpen} aria-hidden="true" />
        <strong>압축 설정</strong>
        <span className="zip-draft-settings__status">{preparationMessage || `${files.length}개 항목${files.length ? ` · ${outputPath || "저장 파일명을 입력하세요"}` : ""}`}</span>
      </button>
      {settingsOpen ? <div className="zip-create-settings">
              <section className="zip-setting-group"><h2>압축 파일 설정</h2>
                <label className="zip-field"><span>압축 형식</span><select value={format} onChange={(event) => { const next = event.target.value; setFormat(next); if (next !== "zip" && next !== "7z") setSplitSize("none"); if (next !== "zip" && next !== "7z") { setPassword(""); setConfirmPassword(""); } setOutputPath((current) => current.replace(/\.[^.\\/]+$/, `.${next}`)); setCompressionMethod("normal"); setOutputConfirmed(false); setPreparationMessage(""); }}><option value="zip">ZIP</option><option value="tar">TAR</option><option value="gz">GZ</option><option value="tgz">TGZ</option><option value="xz">XZ</option><option value="7z">7z</option></select></label>
                <label className="zip-field"><span>파일 이름</span><div className="zip-output-control"><input value={outputPath} onChange={(event) => { setOutputPath(event.target.value); setOutputConfirmed(false); setPreparationMessage(""); }} aria-label="저장 파일 이름 및 경로" /><button type="button" className="zip-button" onClick={() => { void chooseOutputPath(); }} disabled={compressionProgress !== null}>찾아보기…</button></div></label>
                <div className="zip-field"><span>분할 압축</span><div className="zip-split-control"><select value={splitSize} disabled={format !== "zip" && format !== "7z"} onChange={(event) => setSplitSize(event.target.value)}><option value="none">분할하지 않음</option><option value="100">100 MB</option><option value="700">700 MB</option><option value="4096">4 GB</option><option value="custom">사용자 지정</option></select>{splitSize === "custom" ? <div className="zip-custom-size"><input type="number" min="1" value={customSplitSize} onChange={(event) => setCustomSplitSize(event.target.value)} aria-label="분할 크기" /><span>MB</span></div> : null}</div></div>
                <label className="zip-field"><span>압축 방법</span><select value={compressionMethod} disabled={methods.length === 1} onChange={(event) => setCompressionMethod(event.target.value)}>{methods.map((method) => <option value={method.value} key={method.value}>{method.label}</option>)}</select></label>
              </section>
              <section className="zip-setting-group"><h2>암호 설정</h2>
                <label className="zip-field"><span>암호</span><input type={showPassword ? "text" : "password"} disabled={format !== "zip" && format !== "7z"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="암호 입력" /></label>
                <label className="zip-field"><span>암호 확인</span><input type={showPassword ? "text" : "password"} disabled={format !== "zip" && format !== "7z"} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="암호 다시 입력" /></label>
                <label className="zip-show-password"><input type="checkbox" checked={showPassword} onChange={(event) => setShowPassword(event.target.checked)} />암호 표시</label>
                {password && confirmPassword && password !== confirmPassword ? <p className="zip-password-error" role="alert">암호가 일치하지 않습니다.</p> : <p className="zip-setting-hint">{format === "zip" ? "ZIP은 호환성을 위해 ZipCrypto를 사용합니다. 민감한 자료에는 사용하지 마세요." : format === "7z" ? "7z는 AES-256으로 암호화하며 파일 이름도 숨깁니다." : "이 형식은 암호와 분할 압축을 지원하지 않습니다."}</p>}
              </section>
            </div> : null}
    </div>
  );
  return (
    <main className={quickMode ? "zip-app zip-app--quick" : "zip-app"}>
      {detectWorkbenchPlatform() === "windows" || detectWorkbenchPlatform() === "mac" ? <TitleBar /> : <div className="zip-menubar"><Menubar /></div>}
      {SHOW_COMMAND_BAR ? (
        <CommandBar
          archivePath={archive?.path ?? null}
          onOpen={() => { void CommandsRegistry.getCommand("silkZip.file.openArchive")?.handler(); }}
          onNew={() => { void CommandsRegistry.getCommand("silkZip.file.newArchive")?.handler(); }}
          onExtract={(target) => { if (archive) void extractionController.start(archive.path, target); }}
        />
      ) : null}
      <div className="zip-workbench">
        <div className="zip-activity-bar">
          <ActivityBar views={activityViews} />
        </div>
        <div className="zip-workbench__main">
          {page === "settings" ? <ZipSettingsPage /> : page === "keybindings" ? <ZipKeybindingsPage /> : <>
          {elevated && !archive ? <div className="zip-message" role="note">관리자 권한으로 실행 중이라 일반 탐색기에서 이 창으로 파일을 끌어놓을 수 없습니다(끌 때 금지 표시가 나옵니다). 탐색기도 관리자 권한으로 실행하거나 '추가' 버튼을 사용하세요.</div> : null}
          {loading ? <div className="zip-message" role="status">압축 파일을 읽고 있습니다…</div> : null}
          {error ? <div className="zip-message zip-message--error" role="alert">{error}</div> : null}
          {archive ? <ArchiveExplorer archive={pending.view ?? archive} folderRef={folderRef} selectedPathsRef={selectedPathsRef} editor={{ canEdit: pending.editable, addFiles: () => { void addFiles(); }, addFolder: () => { void addFolder(); }, newFolder: (folder) => setFolderPrompt({ folder, siblings: siblingNames(pending.view ?? archive, `${folder ? `${folder}/` : ""}x`) }), remove: (paths) => pending.remove(paths), pendingCount: pending.count, apply: applyPending, discard: pending.discard }} onExtract={(target, entries) => { void extractionController.start(archive.path, target, entries); }} onTest={() => { void extractionController.startTest(archive.path); }} onRename={(entry) => setRenameTarget({ entry, siblings: siblingNames(archive, entry.path), inArchive: true })} selectionRef={archiveSelection} /> : <ArchiveExplorer archive={draft.view} dragging={dragActive} folderRef={folderRef} selectedPathsRef={selectedPathsRef} editor={{ canEdit: true, addFiles: () => { void addFiles(); }, addFolder: () => { void addFolder(); }, newFolder: (folder) => setFolderPrompt({ folder, siblings: siblingNames(draft.view, `${folder ? `${folder}/` : ""}x`) }), remove: (paths) => draft.pending.remove(paths), pendingCount: 0, apply: () => {}, discard: () => {} }} onExtract={() => {}} onTest={() => {}} onRename={() => {}} selectionRef={archiveSelection} draft={{ title: "새 압축", subtitle: "파일이나 폴더를 추가하고 압축 설정을 지정하세요.", emptyMessage: <><strong>파일이나 폴더를 여기로 끌어오세요</strong>또는 추가를 눌러 선택</>, action: { label: compressionProgress ? "압축 중…" : "압축 시작", disabled: files.length === 0 || draft.scanning || compressionProgress !== null, onClick: () => { void prepareCompression(); } }, settings: settingsPanel }} />}
          </>}
        </div>
      </div>
      <div className="zip-status"><span>{archive?.engine ?? "압축 파일을 열려면 파일 메뉴 또는 Ctrl+O를 사용하세요."}</span><span>{elevated ? <b className="zip-status__admin">관리자 권한</b> : null}Silk Studio</span></div>
      {compressionProgress ? <div className="zip-operation-backdrop"><section className="zip-operation-dialog" role="dialog" aria-modal="true" aria-labelledby="zip-progress-title"><h2 id="zip-progress-title" data-tauri-drag-region>압축 중</h2><p>{cancelRequested ? "취소 요청을 처리하고 있습니다…" : compressionProgress.phase === "preparing" ? "압축할 파일을 확인하고 있습니다." : "파일을 ZIP으로 압축하고 있습니다."}</p><div className="zip-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent}><div style={{ width: `${progressPercent}%` }} /></div><span className="zip-progress-detail">{progressPercent}% · {compressionProgress.completedEntries.toLocaleString()} / {compressionProgress.totalEntries.toLocaleString()}개 항목</span><footer><button className="zip-button" onClick={() => { void cancelCompression(); }} disabled={cancelRequested}>{cancelRequested ? "취소 중…" : "취소"}</button></footer></section></div> : null}
      {compressionError ? <div className="zip-operation-backdrop"><section className="zip-operation-dialog zip-error-dialog" role="alertdialog" aria-modal="true" aria-labelledby="zip-error-title" aria-describedby="zip-error-message"><h2 id="zip-error-title" data-tauri-drag-region>압축 오류</h2><p id="zip-error-message">{compressionError}</p><footer><button className="zip-button primary" autoFocus onClick={() => setCompressionError(null)}>확인</button></footer></section></div> : null}
      {completedArchive ? (
        <div className="zip-operation-backdrop">
          <section className="zip-operation-dialog" role="dialog" aria-modal="true" aria-labelledby="zip-complete-title">
            <h2 id="zip-complete-title" data-tauri-drag-region>압축 완료</h2>
            <p>{completedArchive.entries.toLocaleString()}개 항목을 압축했습니다. ({formatFileSize(completedArchive.size)})</p>
            <p>소요 시간 {formatElapsedTime(completedArchive.elapsedMs)}</p>
            <p className="zip-complete-path" title={completedArchive.path}>{completedArchive.path}</p>
            <footer>
              <button className="zip-button" onClick={() => { void openCompletedFolder(); }}>폴더 열기</button>
              <button className="zip-button" onClick={() => setCompletedArchive(null)}>닫기</button>
              {quickMode ? null : <button className="zip-button primary" onClick={() => { void openCompletedArchive(); }}>압축 파일 열기</button>}
            </footer>
          </section>
        </div>
      ) : null}
      {renameTarget ? <RenameDialog request={{ name: renameTarget.entry.name, directory: renameTarget.entry.directory }} siblings={renameTarget.siblings} onCancel={() => setRenameTarget(null)} onSubmit={(name) => {
        const target = renameTarget;
        setRenameTarget(null);
        activeRef.current.rename(target.entry.path, name);
      }} /> : null}
      {folderPrompt ? <RenameDialog title="새 폴더" suggested request={{ name: "새 폴더", directory: true }} siblings={folderPrompt.siblings} onCancel={() => setFolderPrompt(null)} onSubmit={(name) => {
        const target = folderPrompt;
        setFolderPrompt(null);
        const message = activeRef.current.newFolder(target.folder, name);
        if (message) setError(message);
      }} /> : null}
      <CommandPalette />
      <ConfirmDialog />
      <AboutDialog appName="Silk Zip" appVersion="0.1.0" fetchRuntimeInfo={false} showDatabaseRuntimeInfo={false} showLogFolderAction={false} showAiCallLogAction={false} />
      <ExtractDialog controller={extractionController} />
    </main>
  );
}

export default App;
