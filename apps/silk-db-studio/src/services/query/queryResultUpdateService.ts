import { isTauri } from "@tauri-apps/api/core";
import type { QueryRelationKind } from "@silk-studio/db-protocol";
import { ConfigurationService } from "@silk-studio/workbench/platform/configuration/configurationService.ts";
import { tKey } from "@silk-studio/workbench/platform/i18n/activeLocale.ts";
import { bridgeListPrimaryKeys } from "../connection/connectionPrimaryKeysBridge";
import { ConnectionService } from "../connection/connectionService";
import {
  effectiveDefaultSchema,
  getConnectionDriver,
} from "../connection/connectionTypes";
import type { ConnectionDriverId } from "../connection/connectionTypes";
import { EditorConnectionBindingService } from "../connection/editorConnectionBindingService";
import { formatErrorMessage } from "../formatErrorMessage";
import { resolveActiveDriverId } from "../sql/sqlDialect";
import { QueryExecutionService } from "./queryExecutionService";
import { QueryResultDirtyService } from "./queryResultDirtyService";
import {
  buildDeleteStatements,
  buildInsertStatements,
  buildUpdateStatements,
} from "./safeUpdateSql";
import { assertReadOnlyQueryAllowed } from "./sqlGuard";
import { parseSingleTableFromSelect } from "./sqlTableReference";

export type { QueryRelationKind };

export type UpdateEligibility =
  | {
      eligible: true;
      /** Non-null only for a `catalog.schema.table` (SQL Server 3-part) source query — see
       * sqlTableReference.ts. Threaded through so the generated UPDATE/DELETE targets the same
       * catalog the SELECT read from, instead of silently falling back to the session's current
       * catalog. */
      catalog: string | null;
      /** Null when UPDATE should use an unqualified table (session default). */
      schema: string | null;
      table: string;
      primaryKeys: string[];
      driverId: ConnectionDriverId;
    }
  | {
      eligible: false;
      reason: string;
    };

export type UpdatePreview = {
  eligibility: Extract<UpdateEligibility, { eligible: true }>;
  statements: string[];
  dirtyRowCount: number;
  dirtyCellCount: number;
  deletedRowCount: number;
  insertedRowCount: number;
};

type UpdateEligibilityOptions = {
  relationKind?: QueryRelationKind;
  connectionId?: string | null;
};

function resolveExplicitSchemaName(
  tableRef: { schema: string | null; table: string },
  driverId: ConnectionDriverId,
  connectionId?: string | null,
): string {
  if (tableRef.schema?.trim()) {
    return tableRef.schema.trim();
  }

  const profile = connectionId
    ? ConnectionService.getProfile(connectionId)
    : ConnectionService.getConnectedProfile();
  if (!profile) {
    return "";
  }

  /** A runtime schema switch (useSchema) only updates the active tab's binding, not the
   * profile's static default — so an unqualified table must resolve against the binding
   * first, or PK lookup / save-eligibility silently targets the pre-switch schema. */
  const binding = EditorConnectionBindingService.getActiveBinding();
  const fromBinding =
    binding.profileId === profile.id ? binding.schema?.trim() || "" : "";
  if (fromBinding) {
    return fromBinding;
  }

  const driver = getConnectionDriver(driverId);
  if (!driver.showSchemaField) {
    return effectiveDefaultSchema(profile);
  }

  return effectiveDefaultSchema(profile) || profile.catalog.trim();
}

function resolveResultColumn(
  resultColumns: string[],
  metadataName: string,
): string | null {
  const exact = resultColumns.find((column) => column === metadataName);
  if (exact) return exact;
  const lower = metadataName.toLowerCase();
  return resultColumns.find((column) => column.toLowerCase() === lower) ?? null;
}

function blockedReasonForRelationKind(
  kind: QueryRelationKind | undefined,
): string | null {
  if (kind === "view") {
    return tKey("app.query.saveViewsReadonly");
  }
  if (kind === "materializedView") {
    return tKey("app.query.saveMviewsReadonly");
  }
  return null;
}

function noPrimaryKeyReason(
  kind: QueryRelationKind | undefined,
  label: string,
): string {
  if (kind === "table") {
    return tKey("app.query.saveNoPrimaryKey").replace("{table}", label);
  }
  return tKey("app.query.saveNoPrimaryKeyGeneric").replace("{name}", label);
}

export async function resolveUpdateEligibility(
  sql: string,
  resultColumns: string[],
  options?: UpdateEligibilityOptions,
): Promise<UpdateEligibility> {
  if (!isTauri()) {
    return {
      eligible: false,
      reason: tKey("app.query.saveDesktopOnly"),
    };
  }

  const earlyRelationBlock = blockedReasonForRelationKind(options?.relationKind);
  if (earlyRelationBlock) {
    return { eligible: false, reason: earlyRelationBlock };
  }

  const connectionId =
    options?.connectionId?.trim() ||
    ConnectionService.getState().connectedProfileId;
  if (!connectionId || !ConnectionService.isConnected(connectionId)) {
    return {
      eligible: false,
      reason: tKey("app.query.saveNeedConnect"),
    };
  }

  const readOnly = ConfigurationService.getValue("database.readOnly");
  if (readOnly) {
    return {
      eligible: false,
      reason: tKey("app.query.saveReadOnlyUpdate"),
    };
  }

  const tableRef = parseSingleTableFromSelect(sql);
  if (!tableRef) {
    return {
      eligible: false,
      reason: tKey("app.query.saveSimpleSelectOnly"),
    };
  }

  const driverId = resolveActiveDriverId(connectionId);
  const explicitSchema = resolveExplicitSchemaName(
    tableRef,
    driverId,
    connectionId,
  );

  let payload;
  try {
    payload = await bridgeListPrimaryKeys(
      connectionId,
      explicitSchema,
      tableRef.table,
      tableRef.catalog ?? undefined,
    );
  } catch (error) {
    return {
      eligible: false,
      reason: formatErrorMessage(error, tKey("app.query.savePkMetadataFailed")),
    };
  }

  const label = explicitSchema
    ? `${explicitSchema}.${tableRef.table}`
    : tableRef.table;

  /** Prefer non-table metadata over a stale explorer "table" tag (e.g. MV as TABLE). */
  const effectiveKind: QueryRelationKind | undefined = (() => {
    const fromTab = options?.relationKind;
    const fromMeta = payload.relationKind;
    if (fromTab === "view" || fromTab === "materializedView") {
      return fromTab;
    }
    if (fromMeta === "view" || fromMeta === "materializedView") {
      return fromMeta;
    }
    return fromTab ?? fromMeta;
  })();

  const relationBlock = blockedReasonForRelationKind(effectiveKind);
  if (relationBlock) {
    return { eligible: false, reason: relationBlock };
  }

  if (payload.keys.length === 0) {
    return {
      eligible: false,
      reason: noPrimaryKeyReason(effectiveKind, label),
    };
  }

  const resolvedSchema = payload.schema?.trim() || explicitSchema || null;

  const primaryKeys: string[] = [];
  for (const key of payload.keys) {
    const resolved = resolveResultColumn(resultColumns, key.name);
    if (!resolved) {
      return {
        eligible: false,
        reason: tKey("app.query.savePkMissingInResult").replace(
          "{column}",
          key.name,
        ),
      };
    }
    primaryKeys.push(resolved);
  }

  return {
    eligible: true,
    catalog: tableRef.catalog,
    schema: resolvedSchema,
    table: tableRef.table,
    primaryKeys,
    driverId,
  };
}

export async function buildUpdatePreview(
  tabId: string,
  sql: string,
  resultColumns: string[],
  options?: UpdateEligibilityOptions,
): Promise<UpdatePreview | { blocked: true; reason: string }> {
  const newRowIndexes = QueryResultDirtyService.getNewRowIndexes(tabId);
  // Cell edits inside a not-yet-saved added/duplicated row still flow through the same
  // dirty-cell tracking as an existing row's edits — excluded here so they contribute to the
  // row's INSERT values (below) instead of leaking into a bogus UPDATE statement.
  const dirtyRows = QueryResultDirtyService.getDirtyRows(tabId).filter(
    (row) => !QueryResultDirtyService.isNewRow(tabId, row.rowIndex),
  );
  const deletedRowIndexes = QueryResultDirtyService.getDeletedRowIndexes(tabId);
  if (
    dirtyRows.length === 0 &&
    deletedRowIndexes.length === 0 &&
    newRowIndexes.length === 0
  ) {
    return { blocked: true, reason: tKey("app.query.saveNoEditedCells") };
  }

  const eligibility = await resolveUpdateEligibility(
    sql,
    resultColumns,
    options,
  );
  if (!eligibility.eligible) {
    return { blocked: true, reason: eligibility.reason };
  }

  const originalRows = QueryResultDirtyService.getOriginalRows(tabId);
  const newRows = newRowIndexes
    .map((rowIndex) => QueryResultDirtyService.getEffectiveRow(tabId, rowIndex))
    .filter((row): row is Record<string, string | null> => row != null);
  // DELETE first, then UPDATE, then INSERT — a delete or a PK-changing update may free up a
  // primary-key value a same-batch insert/update reuses (e.g. deleting PK=2 and inserting a new
  // row with PK=2); running them in this order avoids a spurious unique-constraint error even
  // though the net result is valid. (Two existing rows swapping PKs with each other still can't
  // be resolved by reordering alone — out of scope here.)
  const statements = [
    ...buildDeleteStatements({
      catalog: eligibility.catalog,
      schema: eligibility.schema,
      table: eligibility.table,
      driverId: eligibility.driverId,
      primaryKeys: eligibility.primaryKeys,
      originalRows,
      deletedRowIndexes,
    }),
    ...buildUpdateStatements({
      catalog: eligibility.catalog,
      schema: eligibility.schema,
      table: eligibility.table,
      driverId: eligibility.driverId,
      primaryKeys: eligibility.primaryKeys,
      originalRows,
      dirtyRows,
    }),
    ...buildInsertStatements({
      catalog: eligibility.catalog,
      schema: eligibility.schema,
      table: eligibility.table,
      driverId: eligibility.driverId,
      columns: resultColumns,
      rows: newRows,
    }),
  ];

  const dirtyCellCount = dirtyRows.reduce(
    (sum, row) => sum + row.changes.length,
    0,
  );
  return {
    eligibility,
    statements,
    dirtyRowCount: dirtyRows.length,
    dirtyCellCount,
    deletedRowCount: deletedRowIndexes.length,
    insertedRowCount: newRows.length,
  };
}

export async function executeConfirmedUpdates(
  tabId: string,
  statements: string[],
  options?: { connectionId?: string | null },
): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  if (statements.length === 0) {
    return { ok: false, message: "No statements to execute." };
  }

  try {
    for (const statement of statements) {
      assertReadOnlyQueryAllowed(statement, ConfigurationService.getValue("database.readOnly"));
      await QueryExecutionService.executeWriteStatement(statement, {
        connectionId: options?.connectionId ?? undefined,
      });
    }

    await QueryExecutionService.refreshTabResult(tabId);
    QueryResultDirtyService.clearTab(tabId);
    const count = statements.length;
    return {
      ok: true,
      message: `${count} statement${count === 1 ? "" : "s"} executed.`,
    };
  } catch (error) {
    return {
      ok: false,
      message: formatErrorMessage(error, "Failed to execute statements."),
    };
  }
}

export function getSaveBlockedReason(
  sql: string,
  dirtyCount: number,
  options?: { relationKind?: QueryRelationKind },
): string | null {
  if (dirtyCount === 0) {
    return tKey("app.query.saveNoEdits");
  }

  if (!isTauri()) {
    return tKey("app.query.saveDesktopShort");
  }

  if (options?.relationKind === "view") {
    return tKey("app.query.saveViewsShort");
  }
  if (options?.relationKind === "materializedView") {
    return tKey("app.query.saveMviewsShort");
  }

  if (ConfigurationService.getValue("database.readOnly")) {
    return tKey("app.query.saveReadOnlyShort");
  }

  if (!parseSingleTableFromSelect(sql)) {
    return tKey("app.query.saveSimpleSelectShort");
  }

  return null;
}
