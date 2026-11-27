import { useCallback, useEffect, useRef, useState } from "react";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { cancelArchive, extractArchive, openOutputFolder, resolveExtractConflict, type ConflictAction, type ExtractConflict, repairArchive, revealInFolder, testArchive, updateArchive, type EntryChange, type NewEntry, type CreateProgress, type ExtractResult, type RepairResult, uniqueFolder } from "../archive.ts";
import { getZipSettings } from "../zipSettings.ts";
import { pickExtractFolder } from "../pickExtractFolder.ts";
import { isNamedTarget, parentFolder, rememberFolder, resolveTargetFolder, type ExtractTarget } from "../extractTargets.ts";

/** One archive of a multi-archive extraction, for the summary. */
type BatchItem = { archivePath: string; outputDir: string; extracted: number; skipped: number; error?: string };
type Batch = { target: ExtractTarget; queue: string[]; items: BatchItem[]; total: number; startedAt: number };

type ExtractState =
  | null
  | { phase: "done"; kind: "batch"; items: BatchItem[]; notRun: number; elapsedMs: number }
  | { phase: "running"; progress: CreateProgress | null }
  | { phase: "password"; message: string }
  | { phase: "conflict"; conflict: ExtractConflict }
  | { phase: "done"; kind: "extract"; result: ExtractResult; elapsedMs: number }
  | { phase: "done"; kind: "test"; tested: number; elapsedMs: number }
  | { phase: "done"; kind: "repair"; result: RepairResult; elapsedMs: number }
  | { phase: "error"; message: string };

function formatDuration(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}초`;
  const whole = Math.round(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  return `${hours ? `${hours}시간 ` : ""}${minutes}분 ${whole % 60}초`;
}

/** Drops the `\?\` prefix Windows adds to long paths. */
function plainPath(path: string): string {
  if (path.startsWith("\\\\?\\UNC\\")) return `\\\\${path.slice(8)}`;
  return path.startsWith("\\\\?\\") ? path.slice(4) : path;
}

function formatStamp(seconds: number): string {
  if (!seconds) return "알 수 없음";
  return new Date(seconds * 1000).toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", minute: "2-digit", second: "2-digit" });
}

function fileName(path: string): string {
  return path.slice(Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/")) + 1);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

/** The folder to write to; a taken archive-named folder becomes "name (2)" instead of being merged into. */
async function targetFolder(target: Exclude<ExtractTarget, "ask">, archivePath: string): Promise<string | undefined> {
  const folder = resolveTargetFolder(target, archivePath);
  return folder && isNamedTarget(target) ? uniqueFolder(folder) : folder;
}

/** Folder pick, progress, password prompt and cancel for one extraction at a time. */
export function useExtraction() {
  const [state, setState] = useState<ExtractState>(null);
  const job = useRef<{ operationId: string; archivePath: string; outputDir: string; entries: string[]; test?: boolean; update?: { changes: EntryChange[]; adds: NewEntry[]; onDone: () => void }; copy?: { onDone: () => void }; repair?: { output: string; onOpen: (path: string) => void }; batch?: Batch; remember?: string } | null>(null);
  const active = useRef(false);

  /**
   * Extracts the current archive and then the queued ones, and shows one summary at the end.
   * A password prompt pauses it; a failed archive is noted and the next one still runs.
   */
  const runBatch = useCallback(async (password: string, batch: Batch) => {
    active.current = true;
    const finish = () => setState({ phase: "done", kind: "batch", items: [...batch.items], notRun: batch.total - batch.items.length, elapsedMs: performance.now() - batch.startedAt });
    try {
      while (job.current) {
        const current = job.current;
        setState({ phase: "running", progress: null });
        const item: BatchItem = { archivePath: current.archivePath, outputDir: current.outputDir, extracted: 0, skipped: 0 };
        try {
          const result = await extractArchive(current.operationId, current.archivePath, current.outputDir, password, getZipSettings().existing, (progress) => {
            setState((previous) => (previous?.phase === "running" ? { phase: "running", progress } : previous));
          }, current.entries, (conflict) => setState({ phase: "conflict", conflict }));
          rememberFolder(typeof batch.target === "object" ? batch.target.dir : result.outputDir);
          if (getZipSettings().openFolderAfter) void openOutputFolder(`${result.outputDir.replace(/[\\/]+$/, "")}/_`);
          batch.items.push({ ...item, outputDir: result.outputDir, extracted: result.extracted, skipped: result.skipped });
        } catch (reason) {
          const message = String(reason);
          if (message.includes("취소")) { finish(); return; }
          if (message.includes("암호")) {
            setState({ phase: "password", message: `${fileName(current.archivePath)}: ${message.includes("필요") ? "암호를 입력하세요." : message}` });
            return;
          }
          batch.items.push({ ...item, error: message });
        }
        password = "";
        const next = batch.queue.shift();
        const folder = next && batch.target !== "ask" ? await targetFolder(batch.target, next) : undefined;
        if (!next || !folder) { finish(); return; }
        job.current = { operationId: `extract-${Date.now()}-${batch.items.length}`, archivePath: next, outputDir: folder, entries: [], batch };
      }
    } finally {
      active.current = false;
    }
  }, []);

  const run = useCallback(async (password: string) => {
    const current = job.current;
    if (!current) return;
    if (current.batch) return runBatch(password, current.batch);
    active.current = true;
    setState({ phase: "running", progress: null });
    const startedAt = performance.now();
    try {
      const onProgress = (progress: CreateProgress) => {
        setState((previous) => (previous?.phase === "running" ? { phase: "running", progress } : previous));
      };
      if (current.repair) {
        const result = await repairArchive(current.operationId, current.archivePath, current.repair.output, password, onProgress);
        setState({ phase: "done", kind: "repair", result, elapsedMs: performance.now() - startedAt });
      } else if (current.copy) {
        await extractArchive(current.operationId, current.archivePath, current.outputDir, password, "overwrite", onProgress, current.entries);
        setState(null);
        current.copy.onDone();
      } else if (current.update) {
        await updateArchive(current.operationId, current.archivePath, current.update.changes, current.update.adds, password, onProgress);
        setState(null);
        current.update.onDone();
      } else if (current.test) {
        const result = await testArchive(current.operationId, current.archivePath, password, onProgress);
        setState({ phase: "done", kind: "test", tested: result.tested, elapsedMs: performance.now() - startedAt });
      } else {
        const result = await extractArchive(current.operationId, current.archivePath, current.outputDir, password, getZipSettings().existing, onProgress, current.entries, (conflict) => setState({ phase: "conflict", conflict }));
        rememberFolder(current.remember ?? result.outputDir);
        if (getZipSettings().openFolderAfter) void openOutputFolder(`${result.outputDir.replace(/[\\/]+$/, "")}/_`);
        setState({ phase: "done", kind: "extract", result, elapsedMs: performance.now() - startedAt });
      }
    } catch (reason) {
      const message = String(reason);
      if (message.includes("취소")) setState(null);
      else if (message.includes("암호")) setState({ phase: "password", message: message.includes("필요") ? "" : message });
      else setState({ phase: "error", message });
    } finally {
      active.current = false;
    }
  }, [runBatch]);

  /** Like `start` for several archives (not for "ask"), with one summary for all of them. */
  const startMany = useCallback(async (archivePaths: string[], target: Exclude<ExtractTarget, "ask">) => {
    if (active.current || archivePaths.length === 0) return;
    const [first, ...queue] = archivePaths;
    const folder = await targetFolder(target, first);
    if (!folder) return;
    const batch: Batch | undefined = queue.length ? { target, queue, items: [], total: archivePaths.length, startedAt: performance.now() } : undefined;
    job.current = { operationId: `extract-${Date.now()}-0`, archivePath: first, outputDir: folder, entries: [], batch, remember: typeof target === "object" ? target.dir : undefined };
    await run("");
  }, [run]);

  const start = useCallback(async (archivePath: string, target: ExtractTarget = "ask", entries: string[] = []) => {
    if (active.current) return;
    let chosen: Exclude<ExtractTarget, "ask">;
    if (target === "ask") {
      let picked;
      try {
        picked = await pickExtractFolder(archivePath);
      } catch (reason) {
        setState({ phase: "error", message: String(reason) });
        return;
      }
      if (!picked) return;
      chosen = picked;
    } else {
      chosen = target;
    }
    const folder = await targetFolder(chosen, archivePath);
    if (!folder) return;
    job.current = { operationId: `extract-${Date.now()}`, archivePath, outputDir: folder, entries, remember: typeof chosen === "object" ? chosen.dir : undefined };
    await run("");
  }, [run]);

  const startTest = useCallback(async (archivePath: string) => {
    if (active.current) return;
    job.current = { operationId: `test-${Date.now()}`, archivePath, outputDir: "", entries: [], test: true };
    await run("");
  }, [run]);

  /** Writes pending changes into the archive in one pass; `onDone` runs once it was rewritten. */
  const startUpdate = useCallback(async (archivePath: string, changes: EntryChange[], adds: NewEntry[], onDone: () => void) => {
    if (active.current) return;
    job.current = { operationId: `update-${Date.now()}`, archivePath, outputDir: "", entries: [], update: { changes, adds, onDone } };
    await run("");
  }, [run]);

  /** Extracts entries into `outputDir` (a fresh temporary folder); `onDone` runs once they are there. */
  const startCopy = useCallback(async (archivePath: string, outputDir: string, entries: string[], onDone: () => void) => {
    if (active.current) return;
    job.current = { operationId: `copy-${Date.now()}`, archivePath, outputDir, entries, copy: { onDone } };
    await run("");
  }, [run]);

  /** Writes what can still be read from a damaged archive into a new archive; `onOpen` opens the result. */
  const startRepair = useCallback(async (archivePath: string, output: string, onOpen: (path: string) => void) => {
    if (active.current) return;
    job.current = { operationId: `repair-${Date.now()}`, archivePath, outputDir: "", entries: [], repair: { output, onOpen } };
    await run("");
  }, [run]);

  const cancel = useCallback(() => {
    if (job.current) void cancelArchive(job.current.operationId);
  }, []);

  /** Answers the "file already exists" question; the extraction carries on afterwards. */
  const resolveConflict = useCallback((action: ConflictAction, applyAll: boolean) => {
    if (!job.current) return;
    setState({ phase: "running", progress: null });
    void resolveExtractConflict(job.current.operationId, action, applyAll);
  }, []);

  const close = useCallback(() => { if (!active.current) setState(null); }, []);

  /** "2/3 · name.zip" while several archives are being extracted. */
  const batchLabel = () => {
    const current = job.current;
    return current?.batch ? `${current.batch.items.length + 1}/${current.batch.total} · ${fileName(current.archivePath)}` : "";
  };

  return { state, start, startMany, batchLabel, startTest, startUpdate, startCopy, startRepair, submitPassword: run, cancel, close, resolveConflict, isTest: () => job.current?.test === true, isUpdate: () => job.current?.update !== undefined, isCopy: () => job.current?.copy !== undefined, isRepair: () => job.current?.repair !== undefined, repairOpen: () => job.current?.repair?.onOpen, outputDir: () => job.current?.outputDir ?? "" };
}

type ExtractionController = ReturnType<typeof useExtraction>;

export function ExtractDialog({ controller }: { controller: ExtractionController }) {
  const { state, submitPassword, cancel, close, resolveConflict } = controller;
  const [password, setPassword] = useState("");
  const [conflictAction, setConflictAction] = useState<ConflictAction>("overwrite");
  const [applyAll, setApplyAll] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => { if (state?.phase !== "password") { setPassword(""); setShowPassword(false); } }, [state?.phase]);
  useEffect(() => { if (state?.phase === "conflict") { setConflictAction("overwrite"); setApplyAll(false); } }, [state]);
  if (!state) return null;

  if (state.phase === "conflict") {
    const { conflict } = state;
    return (
      <div className="workbench-confirm-dialog__backdrop" role="presentation">
        <form className="workbench-confirm-dialog zip-conflict" role="dialog" aria-modal="true" aria-labelledby="zip-conflict-title" onSubmit={(event) => { event.preventDefault(); resolveConflict(conflictAction, applyAll); }}>
          <header className="workbench-confirm-dialog__header" data-tauri-drag-region>
            <h2 id="zip-conflict-title">중복 확인</h2>
            <button type="button" className="workbench-confirm-dialog__close" aria-label="닫기" onClick={() => resolveConflict("cancel", false)}><Codicon name="close" /></button>
          </header>
          <div className="workbench-confirm-dialog__body zip-extract-body">
            <p>이미 같은 이름의 파일이 존재합니다.</p>
            <p className="zip-conflict__path" title={plainPath(conflict.path)}>{plainPath(conflict.path)}</p>
            <div className="zip-conflict__compare">
              <section><h3>기존 파일</h3><p>{formatBytes(conflict.existingSize)}</p><p>{formatStamp(conflict.existingModified)}</p></section>
              <section><h3>압축 풀 파일</h3><p>{formatBytes(conflict.newSize)}</p><p>{formatStamp(conflict.newModified)}</p></section>
            </div>
            <p>어떤 작업을 하시겠습니까?</p>
            <label className="zip-conflict__option"><input type="radio" name="zip-conflict" checked={conflictAction === "skip"} onChange={() => setConflictAction("skip")} /> 건너뛰기</label>
            <label className="zip-conflict__option"><input type="radio" name="zip-conflict" checked={conflictAction === "overwrite"} onChange={() => setConflictAction("overwrite")} /> 덮어쓰기</label>
            <label className="zip-conflict__option"><input type="radio" name="zip-conflict" checked={conflictAction === "rename"} onChange={() => setConflictAction("rename")} /> 이름 변경 (이름 (2).확장자)</label>
            <label className="zip-conflict__option"><input type="checkbox" checked={applyAll} onChange={(event) => setApplyAll(event.target.checked)} /> 모든 파일에 적용</label>
          </div>
          <footer className="workbench-confirm-dialog__footer">
            <button type="submit" className="workbench-confirm-dialog__button workbench-confirm-dialog__button--primary" autoFocus>확인</button>
            <button type="button" className="workbench-confirm-dialog__button" onClick={() => resolveConflict("cancel", false)}>취소</button>
          </footer>
        </form>
      </div>
    );
  }

  const progress = state.phase === "running" ? state.progress : null;
  const percent = progress
    ? progress.phase === "finalizing" ? 100
      : progress.totalBytes > 0 ? Math.min(99, Math.floor(progress.completedBytes / progress.totalBytes * 100))
      : progress.totalEntries > 0 ? Math.min(99, Math.floor(progress.completedEntries / progress.totalEntries * 100)) : 0
    : 0;
  const testing = controller.isTest();
  const updating = controller.isUpdate();
  const copying = controller.isCopy();
  const repairing = controller.isRepair();
  const title = state.phase === "done" ? (state.kind === "test" ? "테스트 완료" : state.kind === "repair" ? "압축 파일 복구 완료" : state.kind === "batch" && (state.notRun > 0 || state.items.some((item) => item.error)) ? "압축 풀기 결과" : "압축 풀기 완료")
    : state.phase === "password" ? "암호 입력"
    : state.phase === "error" ? (repairing ? "압축 파일 복구 실패" : copying ? "복사 실패" : updating ? "변경 적용 실패" : testing ? "압축 파일 테스트 실패" : "압축 풀기 실패")
    : repairing ? "압축 파일 복구 중" : copying ? "복사 준비 중" : updating ? "변경 적용 중" : testing ? "압축 파일 테스트 중" : "압축 푸는 중";
  const canDismiss = state.phase !== "running";

  return (
    <div className="workbench-confirm-dialog__backdrop" role="presentation">
      <div className="workbench-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="zip-extract-title">
        <header className="workbench-confirm-dialog__header" data-tauri-drag-region>
          <h2 id="zip-extract-title">{title}</h2>
          {canDismiss ? <button type="button" className="workbench-confirm-dialog__close" aria-label="닫기" onClick={close}><Codicon name="close" /></button> : null}
        </header>
        <div className="workbench-confirm-dialog__body zip-extract-body">
          {state.phase === "running" ? (
            <>
              {controller.batchLabel() ? <p>{controller.batchLabel()}</p> : null}
              <div className="zip-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><div style={{ width: `${percent}%` }} /></div>
              <p className="zip-progress-detail">
                {progress && progress.phase !== "preparing"
                  ? `${percent}% · ${progress.totalEntries.toLocaleString()}개 중 ${progress.completedEntries.toLocaleString()}개${progress.totalBytes > 0 ? ` · ${formatBytes(progress.completedBytes)} / ${formatBytes(progress.totalBytes)}` : ""}`
                  : "압축 파일을 여는 중..."}
              </p>
            </>
          ) : null}
          {state.phase === "password" ? (
            <form id="zip-extract-password-form" onSubmit={(event) => { event.preventDefault(); if (password) void submitPassword(password); }}>
              <p>{state.message || "암호가 걸린 압축 파일입니다. 암호를 입력하세요."}</p>
              <input className="zip-extract-password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="암호" autoFocus />
              <label className="zip-extract-show"><input type="checkbox" checked={showPassword} onChange={(event) => setShowPassword(event.target.checked)} /> 암호 표시</label>
            </form>
          ) : null}
          {state.phase === "done" && state.kind === "test" ? (
            <p>{`${state.tested.toLocaleString()}개 항목이 모두 정상입니다.
소요 시간: ${formatDuration(state.elapsedMs)}`}</p>
          ) : null}
          {state.phase === "done" && state.kind === "extract" ? (
            <p>{`${state.result.extracted.toLocaleString()}개 항목을 풀었습니다.${state.result.skipped ? `\n이미 있는 ${state.result.skipped.toLocaleString()}개 항목은 건너뛰었습니다.` : ""}\n소요 시간: ${formatDuration(state.elapsedMs)}\n${state.result.outputDir}`}</p>
          ) : null}
          {state.phase === "done" && state.kind === "batch" ? (
            <>
              <p>{`압축 파일 ${(state.items.length + state.notRun).toLocaleString()}개 중 ${state.items.filter((item) => !item.error).length.toLocaleString()}개를 풀었습니다. (${formatDuration(state.elapsedMs)})${state.notRun ? `\n취소하여 풀지 않은 파일: ${state.notRun.toLocaleString()}개` : ""}`}</p>
              <ul className="zip-batch">
                {state.items.map((item) => (
                  <li key={item.archivePath}>
                    <strong>{fileName(item.archivePath)}</strong>
                    {item.error
                      ? <span className="zip-batch__error">{item.error}</span>
                      : <span>{`${item.extracted.toLocaleString()}개 항목${item.skipped ? `, ${item.skipped.toLocaleString()}개 건너뜀` : ""} → ${plainPath(item.outputDir)}`}</span>}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {state.phase === "done" && state.kind === "repair" ? (
            <p>{`${state.result.recovered.toLocaleString()}개 항목을 복구했습니다.${state.result.lost ? `\n읽을 수 없어 복구하지 못한 항목: ${state.result.lost.toLocaleString()}개` : ""}\n소요 시간: ${formatDuration(state.elapsedMs)}\n${state.result.outputPath}`}</p>
          ) : null}
          {state.phase === "error" ? <p>{state.message}</p> : null}
        </div>
        <footer className="workbench-confirm-dialog__footer">
          {state.phase === "running" ? <button type="button" className="workbench-confirm-dialog__button" onClick={cancel}>취소</button> : null}
          {state.phase === "password" ? (
            <>
              <button type="button" className="workbench-confirm-dialog__button" onClick={close}>취소</button>
              <button type="submit" form="zip-extract-password-form" className="workbench-confirm-dialog__button workbench-confirm-dialog__button--primary" disabled={!password}>확인</button>
            </>
          ) : null}
          {state.phase === "done" && state.kind === "test" ? <button type="button" className="workbench-confirm-dialog__button workbench-confirm-dialog__button--primary" autoFocus onClick={close}>확인</button> : null}
          {state.phase === "done" && state.kind === "extract" ? (
            <>
              <button type="button" className="workbench-confirm-dialog__button" onClick={() => { void openOutputFolder(`${state.result.outputDir.replace(/[\\/]+$/, "")}/_`); close(); }}>폴더 열기</button>
              <button type="button" className="workbench-confirm-dialog__button workbench-confirm-dialog__button--primary" autoFocus onClick={close}>확인</button>
            </>
          ) : null}
          {state.phase === "done" && state.kind === "batch" ? (
            <>
              {state.items.some((item) => !item.error) ? <button type="button" className="workbench-confirm-dialog__button" onClick={() => {
                // One folder when they all went to the same place, otherwise the folder that holds them.
                const folders = state.items.filter((item) => !item.error).map((item) => item.outputDir.replace(/[\\/]+$/, ""));
                const shared = folders.every((folder) => folder === folders[0]) ? folders[0] : parentFolder(folders[0]) ?? folders[0];
                void openOutputFolder(`${shared}/_`);
                close();
              }}>폴더 열기</button> : null}
              <button type="button" className="workbench-confirm-dialog__button workbench-confirm-dialog__button--primary" autoFocus onClick={close}>확인</button>
            </>
          ) : null}
          {state.phase === "done" && state.kind === "repair" ? (
            <>
              <button type="button" className="workbench-confirm-dialog__button" onClick={() => { void revealInFolder(state.result.outputPath).catch(() => undefined); close(); }}>폴더 열기</button>
              <button type="button" className="workbench-confirm-dialog__button" onClick={() => { const open = controller.repairOpen(); close(); open?.(state.result.outputPath); }}>복구한 파일 열기</button>
              <button type="button" className="workbench-confirm-dialog__button workbench-confirm-dialog__button--primary" autoFocus onClick={close}>확인</button>
            </>
          ) : null}
          {state.phase === "error" ? <button type="button" className="workbench-confirm-dialog__button workbench-confirm-dialog__button--primary" autoFocus onClick={close}>확인</button> : null}
        </footer>
      </div>
    </div>
  );
}
