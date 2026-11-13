import { invoke } from "@tauri-apps/api/core";

export type ArchiveListing = {
  path: string;
  format: string;
  engine: string;
  entries: { path: string; size: number | null; directory: boolean; encrypted: boolean }[];
  warnings: string[];
};

export function listArchive(path: string): Promise<ArchiveListing> {
  return invoke("archive_list", { path });
}
