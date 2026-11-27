import { Channel, invoke } from "@tauri-apps/api/core";

export type ArchiveListing = {
  path: string;
  format: string;
  engine: string;
  entries: {
    path: string; size: number | null; directory: boolean; encrypted: boolean; status?: "added" | "renamed"; sourcePath?: string | null;
    /** Details read from the archive; absent when the format does not provide them. */
    packedSize?: number; modified?: number; crc?: number; method?: string; encryption?: string; attributes?: number;
  }[];
  warnings: string[];
};

export type CreateProgress = {
  phase: "preparing" | "writing" | "finalizing";
  completedBytes: number;
  totalBytes: number;
  completedEntries: number;
  totalEntries: number;
};

export type CreateResult = { path: string; entries: number; size: number };

export function listArchive(path: string): Promise<ArchiveListing> {
  return invoke("archive_list", { path });
}

export function createArchive(
  operationId: string,
  inputs: { sourcePath: string | null; archivePath: string }[],
  inputEntrySizes: number[],
  outputPath: string,
  format: string,
  compressionLevel: number,
  password: string,
  splitSizeBytes: number | null,
  onProgress: (progress: CreateProgress) => void,
): Promise<CreateResult> {
  const channel = new Channel<CreateProgress>();
  channel.onmessage = onProgress;
  return invoke("archive_create", {
    operationId,
    inputs,
    inputEntrySizes,
    outputPath,
    format,
    compressionLevel,
    password: password || null,
    splitSizeBytes,
    onProgress: channel,
  });
}

export type ExtractResult = { outputDir: string; format: string; extracted: number; skipped: number };

/** A file that already exists where an entry is about to be written (times are Unix seconds, 0 = unknown). */
export type ExtractConflict = { path: string; existingSize: number; existingModified: number; newSize: number; newModified: number };
export type ConflictAction = "skip" | "overwrite" | "rename" | "cancel";

export function extractArchive(
  operationId: string,
  archivePath: string,
  outputDir: string,
  password: string,
  existing: "ask" | "skip" | "overwrite",
  onProgress: (progress: CreateProgress) => void,
  entries: string[] = [],
  onConflict: (conflict: ExtractConflict) => void = () => {},
): Promise<ExtractResult> {
  const channel = new Channel<CreateProgress>();
  channel.onmessage = onProgress;
  const conflicts = new Channel<ExtractConflict>();
  conflicts.onmessage = onConflict;
  return invoke("archive_extract", {
    operationId,
    archivePath,
    outputDir,
    password: password || null,
    overwrite: existing === "overwrite",
    askExisting: existing === "ask",
    entries: entries.length ? entries : null,
    onProgress: channel,
    onConflict: conflicts,
  });
}

export function resolveExtractConflict(operationId: string, action: ConflictAction, applyAll: boolean): Promise<boolean> {
  return invoke("archive_resolve_conflict", { operationId, action, applyAll });
}

/** A pending change to existing entries; applied in order (a folder path covers what is below). */
export type EntryChange = { kind: "delete"; path: string } | { kind: "rename"; from: string; to: string };
/** A new entry; without a source it is an empty folder. */
export type NewEntry = { sourcePath: string | null; archivePath: string };
export type UpdateResult = { removed: number; renamed: number; added: number };

export function updateArchive(
  operationId: string,
  archivePath: string,
  changes: EntryChange[],
  adds: NewEntry[],
  password: string,
  onProgress: (progress: CreateProgress) => void,
): Promise<UpdateResult> {
  const channel = new Channel<CreateProgress>();
  channel.onmessage = onProgress;
  return invoke("archive_update", { operationId, archivePath, changes, adds, password: password || null, onProgress: channel });
}

export type RepairResult = { outputPath: string; format: string; recovered: number; lost: number };

/** Writes what can still be read from a damaged archive into a new archive at `outputPath`. */
export function repairArchive(
  operationId: string,
  archivePath: string,
  outputPath: string,
  password: string,
  onProgress: (progress: CreateProgress) => void,
): Promise<RepairResult> {
  const channel = new Channel<CreateProgress>();
  channel.onmessage = onProgress;
  return invoke("archive_repair", { operationId, archivePath, outputPath, password: password || null, onProgress: channel });
}

export type TestResult = { format: string; tested: number };

export function testArchive(
  operationId: string,
  archivePath: string,
  password: string,
  onProgress: (progress: CreateProgress) => void,
): Promise<TestResult> {
  const channel = new Channel<CreateProgress>();
  channel.onmessage = onProgress;
  return invoke("archive_test", { operationId, archivePath, password: password || null, onProgress: channel });
}

export function reportArchiveProgressDiagnostic(
  operationId: string,
  sample: {
    receivedCount: number;
    receivedSinceLastSample: number;
    sampleIntervalMs: number;
    completedBytes: number;
    totalBytes: number;
    completedEntries: number;
    totalEntries: number;
    lastMessageAgeMs: number;
  },
): Promise<void> {
  return invoke("archive_progress_diagnostic", {
    operationId,
    ...sample,
  });
}

export function cancelArchive(operationId: string): Promise<boolean> {
  return invoke("archive_cancel", { operationId });
}

export function isElevated(): Promise<boolean> {
  return invoke("is_elevated");
}

export function saveArchiveAs(source: string, target: string): Promise<void> {
  return invoke("archive_save_as", { source, target });
}

export function clipboardPrepareDir(): Promise<string> {
  return invoke("clipboard_prepare_dir");
}

export function clipboardCopyDir(dir: string): Promise<number> {
  return invoke("clipboard_copy_dir", { dir });
}

export function clipboardReadFiles(): Promise<string[]> {
  return invoke("clipboard_read_files");
}

export function exitApp(): Promise<void> {
  return invoke("exit_app");
}

export function openNewWindow(admin: boolean): Promise<void> {
  return invoke("new_window", { admin });
}

export function revealInFolder(path: string): Promise<void> {
  return invoke("reveal_in_folder", { path });
}

/** What the app was started to do (from an Explorer/Finder menu); null for a plain start. */
export type LaunchRequest = { action: string; paths: string[] };

/** The answer of the folder dialog Windows shows at start-up; `null` when cancelled. */
export function waitExtractFolder(): Promise<{ dir: string; named: boolean } | null> {
  return invoke("wait_extract_folder");
}

/** Shows the hidden job window of a quick (Explorer menu) job; does nothing once it is shown. */
export function showJobWindow(): Promise<void> {
  return invoke("show_job_window");
}

export function takeLaunchRequest(): Promise<LaunchRequest | null> {
  return invoke("take_launch_request");
}

/** `path`, or the first free `name (2).ext` beside it when something already exists there. */
export function uniquePath(path: string): Promise<string> {
  return invoke("unique_path", { path });
}

/** `path`, or the first free `name (2)` folder beside it when something already exists there. */
export function uniqueFolder(path: string): Promise<string> {
  return invoke("unique_folder", { path });
}

export function openWebsite(url: string): Promise<void> {
  return invoke("open_website", { url });
}

export function openInstallFolder(): Promise<void> {
  return invoke("open_install_folder");
}

export function openOutputFolder(path: string): Promise<void> {
  return invoke("open_output_folder", { path });
}
