import { Channel, invoke } from "@tauri-apps/api/core";

export type ArchiveListing = {
  path: string;
  format: string;
  engine: string;
  entries: { path: string; size: number | null; directory: boolean; encrypted: boolean }[];
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

export function extractArchive(
  operationId: string,
  archivePath: string,
  outputDir: string,
  password: string,
  overwrite: boolean,
  onProgress: (progress: CreateProgress) => void,
  entries: string[] = [],
): Promise<ExtractResult> {
  const channel = new Channel<CreateProgress>();
  channel.onmessage = onProgress;
  return invoke("archive_extract", {
    operationId,
    archivePath,
    outputDir,
    password: password || null,
    overwrite,
    entries: entries.length ? entries : null,
    onProgress: channel,
  });
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

export function openNewWindow(admin: boolean): Promise<void> {
  return invoke("new_window", { admin });
}

export function revealInFolder(path: string): Promise<void> {
  return invoke("reveal_in_folder", { path });
}

export function openOutputFolder(path: string): Promise<void> {
  return invoke("open_output_folder", { path });
}
