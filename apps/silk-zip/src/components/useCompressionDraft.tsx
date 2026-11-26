import { useCallback, useMemo, useState } from "react";
import type { ArchiveListing } from "../archive";
import { usePendingChanges } from "../pendingChanges";

export type DraftEntry = { sourcePath: string | null; archivePath: string; directory: boolean; size: number | null };

const clean = (path: string) => path.replace(/\\/g, "/").split("/").filter((part) => part !== "" && part !== ".").join("/");

/** A new archive does not exist yet: it is an empty archive whose every entry is an addition. */
const EMPTY_ARCHIVE: ArchiveListing = { path: "draft", format: "", engine: "", entries: [], warnings: [] };

/**
 * The list of files going into a new archive. It shares the editing model of an opened archive
 * (add, new folder, rename, remove), so both screens use the same explorer.
 */
export function useCompressionDraft(displayName: string) {
  const pending = usePendingChanges(EMPTY_ARCHIVE, { alwaysEditable: true });
  const [scanning, setScanning] = useState(false);
  const entries = useMemo<DraftEntry[]>(
    () => (pending.view?.entries ?? []).map((entry) => ({ sourcePath: entry.sourcePath ?? null, archivePath: clean(entry.path), directory: entry.directory, size: entry.size })),
    [pending.view],
  );
  /** The listing shown in the explorer, named like the archive that will be written. */
  const view = useMemo<ArchiveListing>(() => ({ ...(pending.view ?? EMPTY_ARCHIVE), path: displayName }), [pending.view, displayName]);
  const add = useCallback(async (paths: string[], folder = ""): Promise<string | null> => {
    setScanning(true);
    try {
      return await pending.add(paths, folder);
    } finally {
      setScanning(false);
    }
  }, [pending.add]);
  return { pending, view, entries, add, reset: pending.discard, scanning };
}
