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
  outputPath: string,
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
    outputPath,
    compressionLevel,
    password: password || null,
    splitSizeBytes,
    onProgress: channel,
  });
}

export function cancelArchive(operationId: string): Promise<boolean> {
  return invoke("archive_cancel", { operationId });
}

export function openOutputFolder(path: string): Promise<void> {
  return invoke("open_output_folder", { path });
}
