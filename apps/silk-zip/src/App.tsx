import { useEffect, useRef, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import ActivityBar from "@silk-studio/workbench/components/layout/ActivityBar/index.ts";
import ViewPaneTitle from "@silk-studio/workbench/components/layout/Sidebar/ViewPaneTitle/ViewPaneTitle.tsx";
import { useLayoutState } from "@silk-studio/workbench/services/layout/useLayoutState.ts";
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
import ConfirmDialog from "@silk-studio/workbench/components/dialogs/ConfirmDialog.tsx";
import { ConfirmDialogService } from "@silk-studio/workbench/services/dialog/confirmDialogService.ts";
import { cancelArchive, createArchive, listArchive, openOutputFolder, reportArchiveProgressDiagnostic, type ArchiveListing, type CreateProgress, type CreateResult } from "./archive";
import ArchiveExplorer from "./components/ArchiveExplorer";
import CommandBar from "./components/CommandBar";
import { ExtractDialog, useExtraction } from "./components/ExtractDialog";
import { useCompressionDraft } from "./components/useCompressionDraft";
import { startRecentArchives } from "./recentArchives";
import type { ExtractTarget } from "./extractTargets";

/** The icon toolbar under the menu bar is kept but hidden; extraction lives in the explorer title row. */
const SHOW_COMMAND_BAR = false;

const ARCHIVE_FILE_FILTERS = [
  { name: "압축 파일", extensions: ["zip", "zipx", "tar", "tgz", "taz", "gz", "gzip", "bz2", "xz", "txz", "lz", "lzma", "lzh", "lha", "iso", "7z", "zpaq", "rar", "rar5"] },
  { name: "모든 파일", extensions: ["*"] },
];

const activityViews: readonly ActivityViewContribution[] = [
  { id: "explorer", icon: "files", label: "탐색기", render: () => null },
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
  const layout = useLayoutState();
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
  const [preparationMessage, setPreparationMessage] = useState("");
  const [compressionProgress, setCompressionProgress] = useState<CreateProgress | null>(null);
  const [compressionError, setCompressionError] = useState<string | null>(null);
  const [cancelRequested, setCancelRequested] = useState(false);
  const [completedArchive, setCompletedArchive] = useState<(CreateResult & { elapsedMs: number }) | null>(null);
  const [archive, setArchive] = useState<ArchiveListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  useEffect(() => {
    ContextKeyService.set("hasOpenArchive", archive !== null);
    ContextKeyService.set("hasArchiveEntrySelection", false);
  }, [archive]);

  useEffect(() => {
    if (!isTauri() || archive !== null) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === "enter" || event.payload.type === "over") {
        setDragActive(true);
        draft.resolveDropTarget(event.payload.position);
      } else if (event.payload.type === "leave") {
        setDragActive(false);
        draft.clearDropTarget();
      } else if (event.payload.type === "drop") {
        setDragActive(false);
        const paths = event.payload.paths ?? [];
        const target = draft.resolveDropTarget(event.payload.position);
        draft.clearDropTarget();
        if (paths.length && !creating.current) void draft.add(paths, target);
      }
    }).then((stop) => {
      if (cancelled) stop();
      else unlisten = stop;
    }).catch((reason) => console.warn("[silkZip.fileDrop] 드롭 이벤트 연결 실패:", reason));
    return () => { cancelled = true; setDragActive(false); draft.clearDropTarget(); unlisten?.(); };
  }, [archive, draft.add, draft.resolveDropTarget, draft.clearDropTarget]);

  useEffect(() => {
    let disposed = false;
    const recentArchives = startRecentArchives(async (path) => {
      if (busy.current) return;
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
    });
    const openArchive = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        const path = await open({ multiple: false, directory: false, filters: ARCHIVE_FILE_FILTERS });
        if (disposed || !path || Array.isArray(path)) return;
        setLoading(true);
        setError(null);
        const result = await listArchive(path);
        if (!disposed) { setArchive(result); recentArchives.record(path); }
      } catch (reason) {
        if (!disposed) setError(String(reason));
      } finally {
        busy.current = false;
        if (!disposed) setLoading(false);
      }
    };
    const newArchive = async () => {
      if (creating.current) return;
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
    const unregisterExtract = CommandsRegistry.registerCommand("silkZip.file.extract", extractCurrentArchive("ask"));
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
    const onKeyDown = (event: KeyboardEvent) => { KeybindingsRegistry.handleKeyboardEvent(event); };
    window.addEventListener("keydown", onKeyDown);
    return () => { disposed = true; recentArchives.stop(); unregisterNewKey(); unregisterNew(); unregisterExtract(); unregisterExtractHere(); unregisterExtractNamed(); unregisterExtractKeys.forEach((stop) => stop()); unregisterKey(); unregister(); window.removeEventListener("keydown", onKeyDown); };
  }, []);
  const addFiles = async () => {
    setAddMenuOpen(false);
    const selected = await open({ multiple: true, directory: false });
    if (selected) await draft.add(Array.isArray(selected) ? selected : [selected]);
  };
  const addFolder = async () => {
    setAddMenuOpen(false);
    const selected = await open({ multiple: true, directory: true });
    if (selected) await draft.add(Array.isArray(selected) ? selected : [selected]);
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

  return (
    <main className="zip-app">
      {detectWorkbenchPlatform() === "windows" ? <TitleBar /> : <div className="zip-menubar"><Menubar /></div>}
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
          {loading ? <div className="zip-message" role="status">압축 파일을 읽고 있습니다…</div> : null}
          {error ? <div className="zip-message zip-message--error" role="alert">{error}</div> : null}
          {archive ? <ArchiveExplorer archive={archive} onExtract={(target) => { void extractionController.start(archive.path, target); }} /> : <div className="zip-start-workspace">
          {layout.sidebar ? <aside className="zip-empty-explorer" style={{ width: layout.sidebarWidth }} aria-label="탐색기"><ViewPaneTitle title="탐색기" />{draft.tree}</aside> : null}
          <section className="zip-content zip-create-form">
            <div className="zip-toolbar"><div><h1>새 압축 파일</h1><p>파일이나 폴더를 추가하고 압축 설정을 지정하세요.</p></div><div className="zip-toolbar__actions"><div className="zip-add-menu" ref={addMenuRef}><div className="zip-extract-split"><button className="zip-button zip-extract-split__main" title="파일 추가" onClick={addFiles}>추가</button><button className="zip-button zip-extract-split__arrow" aria-label="추가 옵션" aria-haspopup="menu" aria-expanded={addMenuOpen} onClick={() => setAddMenuOpen((open) => !open)}><span className="codicon codicon-chevron-down" aria-hidden="true" /></button></div>{addMenuOpen ? <div className="zip-add-menu__popup" role="menu"><button role="menuitem" onClick={addFiles}>파일 추가</button><button role="menuitem" onClick={addFolder}>폴더 추가</button></div> : null}</div><button className="zip-button" onClick={draft.newFolder}>새 폴더</button><button className="zip-button" onClick={draft.remove} disabled={draft.selectedCount === 0}>제거</button></div></div>
            <div className={`zip-drop${files.length ? " zip-drop--filled" : ""}${dragActive ? " zip-drop--dragging" : ""}`} onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false); }} onDrop={(event) => { event.preventDefault(); setDragActive(false); }}>
              {draft.list}
            </div>
            <div className="zip-create-settings">
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
            </div>
            <footer className="zip-footer"><span>{preparationMessage || `${files.length}개 항목${files.length ? ` · ${outputPath || "저장 파일명을 입력하세요"}` : ""}`}</span><button className="zip-button primary" onClick={() => { void prepareCompression(); }} disabled={files.length === 0 || draft.pending || compressionProgress !== null}>{compressionProgress ? "압축 중…" : "압축 시작"}</button></footer>
          </section></div>}
        </div>
      </div>
      <div className="zip-status"><span>{archive?.engine ?? "압축 파일을 열려면 파일 메뉴 또는 Ctrl+O를 사용하세요."}</span><span>Silk Studio</span></div>
      {compressionProgress ? <div className="zip-operation-backdrop"><section className="zip-operation-dialog" role="dialog" aria-modal="true" aria-labelledby="zip-progress-title"><h2 id="zip-progress-title">압축 중</h2><p>{cancelRequested ? "취소 요청을 처리하고 있습니다…" : compressionProgress.phase === "preparing" ? "압축할 파일을 확인하고 있습니다." : "파일을 ZIP으로 압축하고 있습니다."}</p><div className="zip-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent}><div style={{ width: `${progressPercent}%` }} /></div><span className="zip-progress-detail">{progressPercent}% · {compressionProgress.completedEntries.toLocaleString()} / {compressionProgress.totalEntries.toLocaleString()}개 항목</span><footer><button className="zip-button" onClick={() => { void cancelCompression(); }} disabled={cancelRequested}>{cancelRequested ? "취소 중…" : "취소"}</button></footer></section></div> : null}
      {compressionError ? <div className="zip-operation-backdrop"><section className="zip-operation-dialog zip-error-dialog" role="alertdialog" aria-modal="true" aria-labelledby="zip-error-title" aria-describedby="zip-error-message"><h2 id="zip-error-title">압축 오류</h2><p id="zip-error-message">{compressionError}</p><footer><button className="zip-button primary" autoFocus onClick={() => setCompressionError(null)}>확인</button></footer></section></div> : null}
      {completedArchive ? (
        <div className="zip-operation-backdrop">
          <section className="zip-operation-dialog" role="dialog" aria-modal="true" aria-labelledby="zip-complete-title">
            <h2 id="zip-complete-title">압축 완료</h2>
            <p>{completedArchive.entries.toLocaleString()}개 항목을 압축했습니다. ({formatFileSize(completedArchive.size)})</p>
            <p>소요 시간 {formatElapsedTime(completedArchive.elapsedMs)}</p>
            <p className="zip-complete-path" title={completedArchive.path}>{completedArchive.path}</p>
            <footer>
              <button className="zip-button" onClick={() => { void openCompletedFolder(); }}>폴더 열기</button>
              <button className="zip-button" onClick={() => setCompletedArchive(null)}>닫기</button>
              <button className="zip-button primary" onClick={() => { void openCompletedArchive(); }}>압축 파일 열기</button>
            </footer>
          </section>
        </div>
      ) : null}
      <ConfirmDialog />
      <ExtractDialog controller={extractionController} />
    </main>
  );
}

export default App;
