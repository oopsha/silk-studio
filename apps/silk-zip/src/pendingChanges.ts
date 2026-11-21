import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ArchiveListing, EntryChange, NewEntry } from "./archive";

type ListedEntry = ArchiveListing["entries"][number];

interface PendingState {
  /** The listing these edits belong to; edits of an older listing are ignored. */
  base: ArchiveListing | null;
  entries: ListedEntry[];
  changes: EntryChange[];
  /** User actions since the archive was opened (shown as "변경 N개"). */
  actions: number;
}

const clean = (path: string) => path.replace(/\\/g, "/").split("/").filter((part) => part !== "" && part !== ".").join("/");
const parentOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
const under = (path: string, folder: string) => path === folder || path.startsWith(`${folder}/`);

/** Only formats the engine can rewrite: zip, 7z and tar (not split or compressed tars). */
export function canEditArchive(archivePath: string): boolean {
  return /\.(zip|7z|tar)$/i.test(archivePath);
}

/**
 * Edits made to an opened archive (add, remove, rename, new folder) are kept here and shown in the
 * explorer; they reach the file only when applied, which rewrites the archive once.
 */
export function usePendingChanges(archive: ArchiveListing | null) {
  const [state, setState] = useState<PendingState>({ base: null, entries: [], changes: [], actions: 0 });

  useEffect(() => {
    setState({ base: archive, entries: archive ? archive.entries.map((entry) => ({ ...entry })) : [], changes: [], actions: 0 });
  }, [archive]);

  const fresh = state.base === archive;
  const view = useMemo<ArchiveListing | null>(() => (archive ? { ...archive, entries: fresh ? state.entries : archive.entries } : null), [archive, state.entries, fresh]);
  const editable = archive !== null && canEditArchive(archive.path);

  const exists = (entries: ListedEntry[], path: string) =>
    entries.some((entry) => clean(entry.path).toLocaleLowerCase() === path.toLocaleLowerCase());

  /** Adds files and folders from disk below `folder`; resolves with an error message or null. */
  const add = useCallback(async (paths: string[], folder: string): Promise<string | null> => {
    if (!archive || !paths.length) return null;
    const scanned = await invoke<[string, string, number | null, boolean][]>("draft_scan", { paths });
    let error: string | null = null;
    setState((current) => {
      const additions: ListedEntry[] = scanned.map(([sourcePath, name, size, directory]) => ({
        path: folder ? `${folder}/${name}` : name,
        size,
        directory,
        encrypted: false,
        status: "added",
        sourcePath,
      }));
      const clash = additions.find((entry) => exists(current.entries, clean(entry.path)));
      if (clash) {
        error = `같은 이름의 항목이 이미 있습니다: ${clean(clash.path)}`;
        return current;
      }
      return { ...current, entries: [...current.entries, ...additions], actions: current.actions + 1 };
    });
    return error;
  }, [archive]);

  const newFolder = useCallback((folder: string, name: string): string | null => {
    const path = folder ? `${folder}/${name}` : name;
    let error: string | null = null;
    setState((current) => {
      if (exists(current.entries, path)) {
        error = `같은 이름의 항목이 이미 있습니다: ${path}`;
        return current;
      }
      const entry: ListedEntry = { path, size: null, directory: true, encrypted: false, status: "added", sourcePath: null };
      return { ...current, entries: [...current.entries, entry], actions: current.actions + 1 };
    });
    return error;
  }, []);

  const remove = useCallback((paths: string[]) => {
    setState((current) => {
      let entries = current.entries;
      const changes = [...current.changes];
      for (const raw of paths) {
        const path = clean(raw);
        const affected = entries.filter((entry) => under(clean(entry.path), path));
        if (!affected.length) continue;
        // Entries that exist in the file need a delete; added ones are simply dropped.
        if (affected.some((entry) => entry.status !== "added")) changes.push({ kind: "delete", path });
        entries = entries.filter((entry) => !under(clean(entry.path), path));
      }
      return entries === current.entries ? current : { ...current, entries, changes, actions: current.actions + 1 };
    });
  }, []);

  const rename = useCallback((path: string, name: string) => {
    setState((current) => {
      const from = clean(path);
      const parent = parentOf(from);
      const to = parent ? `${parent}/${name}` : name;
      let touchedExisting = false;
      const entries = current.entries.map((entry) => {
        const entryPath = clean(entry.path);
        if (!under(entryPath, from)) return entry;
        if (entry.status !== "added") touchedExisting = true;
        return { ...entry, path: to + entryPath.slice(from.length), status: entry.status === "added" ? entry.status : "renamed" } as ListedEntry;
      });
      const changes = touchedExisting ? [...current.changes, { kind: "rename", from, to } as EntryChange] : current.changes;
      return { ...current, entries, changes, actions: current.actions + 1 };
    });
  }, []);

  const discard = useCallback(() => {
    setState({ base: archive, entries: archive ? archive.entries.map((entry) => ({ ...entry })) : [], changes: [], actions: 0 });
  }, [archive]);

  /** What to send to the engine: ordered changes of existing entries plus the new entries. */
  const request = useCallback((): { changes: EntryChange[]; adds: NewEntry[] } => ({
    changes: state.changes,
    adds: state.entries
      .filter((entry) => entry.status === "added")
      .map((entry) => ({ sourcePath: entry.directory && !entry.sourcePath ? null : entry.sourcePath ?? null, archivePath: clean(entry.path) })),
  }), [state]);

  return { view, editable, dirty: fresh && state.actions > 0, count: fresh ? state.actions : 0, add, newFolder, remove, rename, discard, request };
}

export type PendingChanges = ReturnType<typeof usePendingChanges>;
