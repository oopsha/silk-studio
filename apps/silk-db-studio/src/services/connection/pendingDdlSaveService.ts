/**
 * Tracks PL/SQL saves that pushed DDL (CREATE OR REPLACE / ALTER) to a connection whose DDL is
 * transactional and currently `dirty` (see `ConnectionTransactionService`/`driverAutoCommitsDdl`
 * in `sqlDialect.ts`) — i.e. the write succeeded but is only *pending* until the user explicitly
 * commits via the status bar. Recording the local snapshot/marking the tab clean at write time
 * would be wrong in that case: if the user rolls back instead, Silk's local history and "tab is
 * clean" state would no longer match the database.
 *
 * `compileActivePlsqlObject`/`executePlsqlSave` register an entry here instead of applying their
 * post-save side effects immediately; `connectionTransactionService.ts`'s commit/rollback/
 * disconnect handling resolves or discards them once the outcome is known.
 */

export type PendingDdlSaveOutcome = {
  onCommit: () => void;
  onRollback: () => void;
};

const pending = new Map<string, PendingDdlSaveOutcome[]>();

/** Registers a pending save outcome for `connectionId`, to be resolved on commit/rollback. */
export function registerPendingDdlSave(
  connectionId: string,
  entry: PendingDdlSaveOutcome,
): void {
  const list = pending.get(connectionId);
  if (list) {
    list.push(entry);
  } else {
    pending.set(connectionId, [entry]);
  }
}

/**
 * Takes and clears every pending save entry registered for `connectionId`, then invokes each
 * entry's `onCommit` or `onRollback` callback (never both) according to `outcome`. No-op when
 * nothing is pending for this connection.
 */
export function resolvePendingDdlSaves(
  connectionId: string,
  outcome: "commit" | "rollback",
): void {
  const list = pending.get(connectionId);
  if (!list || list.length === 0) return;
  pending.delete(connectionId);
  for (const entry of list) {
    if (outcome === "commit") {
      entry.onCommit();
    } else {
      entry.onRollback();
    }
  }
}

/**
 * Drops every pending save entry registered for `connectionId` without invoking anything — used
 * on disconnect, where there is no DB session left to have committed/rolled back against.
 */
export function discardPendingDdlSaves(connectionId: string): void {
  pending.delete(connectionId);
}
