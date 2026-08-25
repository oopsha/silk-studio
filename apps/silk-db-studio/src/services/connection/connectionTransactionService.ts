import { tKey } from "@silk-studio/workbench/platform/i18n/activeLocale.ts";
import { AppNotificationService } from "@silk-studio/workbench/services/notifications/appNotificationService.ts";
import { formatErrorMessage } from "../formatErrorMessage";
import { ConfirmDialogService } from "../ui/confirmDialogService";
import { bridgeCommit, bridgeRollback } from "./connectionBridge";
import { ConnectionService } from "./connectionService";
import {
  discardPendingDdlSaves,
  resolvePendingDdlSaves,
} from "./pendingDdlSaveService";

type TransactionListener = () => void;

/**
 * Tracks, per JDBC session (connectionId), whether a write has run since the
 * last commit/rollback while `database.autoCommit` is off. JDBC has no
 * "has pending changes" query, so this is tracked client-side: marked dirty
 * after a successful write statement (see QueryExecutionService.invokeQuery),
 * cleared on commit/rollback and whenever the connection disconnects.
 */
class ConnectionTransactionServiceImpl {
  private readonly dirty = new Set<string>();
  private readonly listeners = new Set<TransactionListener>();

  constructor() {
    ConnectionService.onDidChange(() => {
      const connected = new Set(ConnectionService.getState().connectedProfileIds);
      let changed = false;
      for (const id of this.dirty) {
        if (!connected.has(id)) {
          this.dirty.delete(id);
          changed = true;
          // No DB session left to have committed/rolled back against — drop silently, no
          // user-visible error (see pendingDdlSaveService.ts).
          discardPendingDdlSaves(id);
        }
      }
      if (changed) {
        this.fire();
      }
    });
  }

  isDirty(connectionId: string | null | undefined): boolean {
    return Boolean(connectionId && this.dirty.has(connectionId));
  }

  markDirty(connectionId: string): void {
    if (this.dirty.has(connectionId)) return;
    this.dirty.add(connectionId);
    this.fire();
  }

  clear(connectionId: string): void {
    if (!this.dirty.has(connectionId)) return;
    this.dirty.delete(connectionId);
    this.fire();
  }

  onDidChange(listener: TransactionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private fire(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const ConnectionTransactionService = new ConnectionTransactionServiceImpl();

function connectionDisplayName(connectionId: string): string {
  return ConnectionService.getProfile(connectionId)?.name ?? connectionId;
}

/** Commits the pending transaction for `connectionId` (status bar action). */
export async function commitConnection(connectionId: string): Promise<void> {
  try {
    const result = await bridgeCommit(connectionId);
    ConnectionTransactionService.clear(connectionId);
    // "Nothing to commit" is treated as commit-success for pending saves too: if the driver
    // reports nothing pending, whatever we were tracking here is no longer blocked on anything.
    resolvePendingDdlSaves(connectionId, "commit");
    AppNotificationService.show(
      result.committed ? tKey("app.transaction.committed") : tKey("app.transaction.nothingToCommit"),
      "success",
    );
  } catch (error) {
    AppNotificationService.show(
      tKey("app.transaction.commitFailed").replace(
        "{message}",
        formatErrorMessage(error, String(error)),
      ),
      "error",
    );
  }
}

/** Rolls back the pending transaction for `connectionId`, after user confirmation. */
export async function rollbackConnection(connectionId: string): Promise<void> {
  const name = connectionDisplayName(connectionId);
  const confirmed = await ConfirmDialogService.confirm({
    title: tKey("app.transaction.rollback"),
    message: tKey("app.transaction.rollbackConfirm").replace("{name}", name),
    confirmLabel: tKey("app.transaction.rollback"),
    danger: true,
  });
  if (!confirmed) {
    return;
  }
  try {
    const result = await bridgeRollback(connectionId);
    ConnectionTransactionService.clear(connectionId);
    // "Nothing to roll back" is treated conservatively as a rollback outcome for pending saves
    // too — we can't prove the save survived, so discard rather than mark it durable.
    resolvePendingDdlSaves(connectionId, "rollback");
    if (result.rolledBack) {
      // Dynamic import breaks the query <-> connection service cycle (same
      // pattern as resolveExecutionConnection.ts's ActiveDatabaseService import).
      const { QueryExecutionService } = await import(
        "../query/queryExecutionService"
      );
      await QueryExecutionService.refreshResultTabsForConnection(connectionId);
    }
    AppNotificationService.show(
      result.rolledBack ? tKey("app.transaction.rolledBack") : tKey("app.transaction.nothingToRollback"),
      "success",
    );
  } catch (error) {
    AppNotificationService.show(
      tKey("app.transaction.rollbackFailed").replace(
        "{message}",
        formatErrorMessage(error, String(error)),
      ),
      "error",
    );
  }
}
