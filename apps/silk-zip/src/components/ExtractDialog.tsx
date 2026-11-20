import { useCallback, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { cancelArchive, extractArchive, openOutputFolder, type CreateProgress, type ExtractResult } from "../archive.ts";
import { parentFolder, rememberFolder, resolveTargetFolder, type ExtractTarget } from "../extractTargets.ts";

type ExtractState =
  | null
  | { phase: "running"; progress: CreateProgress | null }
  | { phase: "password"; message: string }
  | { phase: "done"; result: ExtractResult; elapsedMs: number }
  | { phase: "error"; message: string };

function formatDuration(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}초`;
  const whole = Math.round(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  return `${hours ? `${hours}시간 ` : ""}${minutes}분 ${whole % 60}초`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

/** Folder pick, progress, password prompt and cancel for one extraction at a time. */
export function useExtraction() {
  const [state, setState] = useState<ExtractState>(null);
  const job = useRef<{ operationId: string; archivePath: string; outputDir: string } | null>(null);
  const active = useRef(false);

  const run = useCallback(async (password: string) => {
    const current = job.current;
    if (!current) return;
    active.current = true;
    setState({ phase: "running", progress: null });
    const startedAt = performance.now();
    try {
      const result = await extractArchive(current.operationId, current.archivePath, current.outputDir, password, false, (progress) => {
        setState((previous) => (previous?.phase === "running" ? { phase: "running", progress } : previous));
      });
      rememberFolder(result.outputDir);
      setState({ phase: "done", result, elapsedMs: performance.now() - startedAt });
    } catch (reason) {
      const message = String(reason);
      if (message.includes("취소")) setState(null);
      else if (message.includes("암호")) setState({ phase: "password", message: message.includes("필요") ? "" : message });
      else setState({ phase: "error", message });
    } finally {
      active.current = false;
    }
  }, []);

  const start = useCallback(async (archivePath: string, target: ExtractTarget = "ask") => {
    if (active.current) return;
    let folder: string | string[] | null | undefined;
    if (target === "ask") {
      folder = await open({ multiple: false, directory: true, title: "압축을 풀 폴더 선택", defaultPath: parentFolder(archivePath) });
    } else {
      folder = resolveTargetFolder(target, archivePath);
    }
    if (!folder || Array.isArray(folder)) return;
    job.current = { operationId: `extract-${Date.now()}`, archivePath, outputDir: folder };
    await run("");
  }, [run]);

  const cancel = useCallback(() => {
    if (job.current) void cancelArchive(job.current.operationId);
  }, []);

  const close = useCallback(() => { if (!active.current) setState(null); }, []);

  return { state, start, submitPassword: run, cancel, close, outputDir: () => job.current?.outputDir ?? "" };
}

type ExtractionController = ReturnType<typeof useExtraction>;

export function ExtractDialog({ controller }: { controller: ExtractionController }) {
  const { state, submitPassword, cancel, close } = controller;
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => { if (state?.phase !== "password") { setPassword(""); setShowPassword(false); } }, [state?.phase]);
  if (!state) return null;

  const progress = state.phase === "running" ? state.progress : null;
  const percent = progress
    ? progress.phase === "finalizing" ? 100
      : progress.totalBytes > 0 ? Math.min(99, Math.floor(progress.completedBytes / progress.totalBytes * 100))
      : progress.totalEntries > 0 ? Math.min(99, Math.floor(progress.completedEntries / progress.totalEntries * 100)) : 0
    : 0;
  const title = state.phase === "done" ? "압축 풀기 완료" : state.phase === "password" ? "암호 입력" : state.phase === "error" ? "압축 풀기 실패" : "압축 푸는 중";
  const canDismiss = state.phase !== "running";

  return (
    <div className="workbench-confirm-dialog__backdrop" role="presentation">
      <div className="workbench-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="zip-extract-title">
        <header className="workbench-confirm-dialog__header">
          <h2 id="zip-extract-title">{title}</h2>
          {canDismiss ? <button type="button" className="workbench-confirm-dialog__close" aria-label="닫기" onClick={close}><Codicon name="close" /></button> : null}
        </header>
        <div className="workbench-confirm-dialog__body zip-extract-body">
          {state.phase === "running" ? (
            <>
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
          {state.phase === "done" ? (
            <p>{`${state.result.extracted.toLocaleString()}개 항목을 풀었습니다.${state.result.skipped ? `\n이미 있는 ${state.result.skipped.toLocaleString()}개 항목은 건너뛰었습니다.` : ""}\n소요 시간: ${formatDuration(state.elapsedMs)}\n${state.result.outputDir}`}</p>
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
          {state.phase === "done" ? (
            <>
              <button type="button" className="workbench-confirm-dialog__button" onClick={() => { void openOutputFolder(`${state.result.outputDir.replace(/[\/]+$/, "")}/_`); close(); }}>폴더 열기</button>
              <button type="button" className="workbench-confirm-dialog__button workbench-confirm-dialog__button--primary" autoFocus onClick={close}>확인</button>
            </>
          ) : null}
          {state.phase === "error" ? <button type="button" className="workbench-confirm-dialog__button workbench-confirm-dialog__button--primary" autoFocus onClick={close}>확인</button> : null}
        </footer>
      </div>
    </div>
  );
}
