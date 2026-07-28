import { ConfigurationService } from "@silk-studio/workbench/platform/configuration/configurationService.ts";
import { ConnectionService } from "./connectionService";
import type { ExplorerObjectRef } from "./explorerObjectActions";
import { ConnectionTreeService } from "./connectionTreeService";
import { ExplorerObjectMutationDialogService } from "./explorerObjectMutationDialogService";
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

function assertMutationsAllowed(): void {
  const readOnly = ConfigurationService.getValue("database.readOnly");
  if (readOnly) {
    throw new Error(
      "Read-only mode is enabled. DROP and RENAME are blocked.",
    );
  }
  if (!ConnectionService.isConnected()) {
    throw new Error("Connect a database profile before modifying objects.");
  }
}

function resolveDriverId(ref: ExplorerObjectRef) {
  const profile = ConnectionService.getProfile(ref.profileId);
  if (!profile) {
    throw new Error("Connection profile not found.");
  }
  const { connectedProfileId } = ConnectionService.getState();
  if (connectedProfileId !== ref.profileId || !ConnectionService.isConnected()) {
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
    throw new Error("Rename is only supported on Oracle and PostgreSQL (tables/views) in v1.");
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

  const ctx = mutationContextFromRef(ref, driverId);
  const sql =
    mode === "drop"
      ? buildDropObjectSql(ctx)
      : buildRenameObjectSql(ctx, newName ?? "");

  assertReadOnlyQueryAllowed(sql, ConfigurationService.getValue("database.readOnly"));
  await QueryExecutionService.executeWriteStatement(sql);
  await ConnectionTreeService.invalidateAndRefreshSchema(
    ref.profileId,
    ref.schemaName,
  );
}

export function formatMutationError(error: unknown, fallback: string): string {
  return formatErrorMessage(error, fallback);
}
