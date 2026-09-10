import { ConfigurationService } from "@silk-studio/workbench/platform/configuration/configurationService.ts";
import { tKey } from "@silk-studio/workbench/platform/i18n/activeLocale.ts";
import { AppNotificationService } from "@silk-studio/workbench/services/notifications/appNotificationService.ts";
import { ConnectionService } from "./connectionService";
import type { ExplorerObjectRef } from "./explorerObjectActions";
import { ConnectionTreeService } from "./connectionTreeService";
import { ConnectionTransactionService } from "./connectionTransactionService";
import { ActiveDatabaseService } from "./activeDatabaseService";
import { ExplorerObjectMutationDialogService } from "./explorerObjectMutationDialogService";
import { registerPendingDdlSave } from "./pendingDdlSaveService";
import {
  buildDropObjectSql,
  buildRenameObjectSql,
  mutationContextFromRef,
  supportsDropObject,
  supportsRenameObject,
} from "./explorerObjectMutationSql";
import { formatErrorMessage } from "../formatErrorMessage";
import { QueryExecutionService } from "../query/queryExecutionService";
import { assertReadOnlyQueryAllowed } from "../query/sqlGuard";
import { driverAutoCommitsDdl } from "../sql/sqlDialect";

function assertMutationsAllowed(): void {
  const readOnly = ConfigurationService.getValue("database.readOnly");
  if (readOnly) {
    throw new Error(
      "Read-only mode is enabled. DROP and RENAME are blocked.",
    );
  }
}

function resolveDriverId(ref: ExplorerObjectRef) {
  const profile = ConnectionService.getProfile(ref.profileId);
  if (!profile) {
    throw new Error("Connection profile not found.");
  }
  if (!ConnectionService.isConnected(ref.profileId)) {
    throw new Error("Connect this profile before modifying objects.");
  }
  return profile.driverId;
}

export function openDropObjectDialog(ref: ExplorerObjectRef): void {
  assertMutationsAllowed();
  const driverId = resolveDriverId(ref);
  if (!supportsDropObject(ref.object.kind, driverId)) {
    throw new Error(`DROP is not supported for ${ref.object.kind} on this driver.`);
  }
  ExplorerObjectMutationDialogService.open({ mode: "drop", ref, driverId });
}

export function openRenameObjectDialog(ref: ExplorerObjectRef): void {
  assertMutationsAllowed();
  const driverId = resolveDriverId(ref);
  if (!supportsRenameObject(ref.object.kind, driverId)) {
    throw new Error("Rename is supported for Oracle, PostgreSQL tables/views, and SQL Server tables.");
  }
  ExplorerObjectMutationDialogService.open({ mode: "rename", ref, driverId });
}

export function previewDropSql(ref: ExplorerObjectRef, driverId: string): string {
  return buildDropObjectSql(
    mutationContextFromRef(ref, driverId as ReturnType<typeof resolveDriverId>),
  );
}

export function previewRenameSql(
  ref: ExplorerObjectRef,
  driverId: string,
  newName: string,
): string {
  return buildRenameObjectSql(
    mutationContextFromRef(ref, driverId as ReturnType<typeof resolveDriverId>),
    newName,
  );
}

export async function executeExplorerMutation(
  ref: ExplorerObjectRef,
  driverId: ReturnType<typeof resolveDriverId>,
  mode: "drop" | "rename",
  newName?: string,
): Promise<void> {
  assertMutationsAllowed();
  // An explorer action establishes this profile as the current connection context. Object/DDL
  // editor tabs are not SQL tabs and may not carry a direct editor binding for the status bar.
  ConnectionService.setActiveProfile(ref.profileId);

  const ctx = mutationContextFromRef(ref, driverId);
  const sql =
    mode === "drop"
      ? buildDropObjectSql(ctx)
      : buildRenameObjectSql(ctx, newName ?? "");

  assertReadOnlyQueryAllowed(sql, ConfigurationService.getValue("database.readOnly"));
  // SQL Server's sys.sp_rename may rename objects in the current database only. Explorer can
  // list other catalogs under the same connection, so make the clicked catalog current first.
  if (mode === "rename" && driverId === "sqlserver" && ref.catalogName?.trim()) {
    await ActiveDatabaseService.useDatabase(ref.profileId, ref.catalogName);
  }
  await QueryExecutionService.executeWriteStatement(sql, {
    connectionId: ref.profileId,
  });
  // Explorer mutations do not create a query-result tab, so make the transaction state explicit
  // here rather than relying on that UI path to have observed the successful DDL write already.
  const pendingTransaction =
    !ConfigurationService.getValue("database.autoCommit") &&
    !driverAutoCommitsDdl(driverId);
  if (pendingTransaction) {
    ConnectionTransactionService.markDirty(ref.profileId);
  }
  await ConnectionTreeService.invalidateAndRefreshSchema(
    ref.profileId,
    ref.schemaName,
    ref.catalogName ?? undefined,
  );

  // PostgreSQL and SQL Server keep DDL inside the active transaction. The first refresh above
  // deliberately reflects that session's pending state; restore the tree from the database when
  // the user later rolls back instead of leaving the deleted/renamed object hidden until reconnect.
  if (pendingTransaction && ConnectionTransactionService.isDirty(ref.profileId)) {
    registerPendingDdlSave(ref.profileId, {
      onCommit: () => undefined,
      onRollback: () => {
        void ConnectionTreeService.invalidateAndRefreshSchema(
          ref.profileId,
          ref.schemaName,
          ref.catalogName ?? undefined,
        );
        AppNotificationService.show(
          tKey("app.explorer.objectMutationRolledBack"),
          "info",
        );
      },
    });
    AppNotificationService.show(
      tKey("app.explorer.objectMutationPendingCommit"),
      "info",
    );
  }
}

export function formatMutationError(error: unknown, fallback: string): string {
  return formatErrorMessage(error, fallback);
}
