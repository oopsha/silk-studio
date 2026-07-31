import { isTauri } from "@tauri-apps/api/core";
import { ConfigurationService } from "@silk-studio/workbench/platform/configuration/configurationService.ts";
import { tKey } from "@silk-studio/workbench/platform/i18n/activeLocale.ts";
import { bridgeListPrimaryKeys } from "../connection/connectionPrimaryKeysBridge";
import { ConnectionService } from "../connection/connectionService";
import { getConnectionDriver } from "../connection/connectionTypes";
import type { ConnectionDriverId } from "../connection/connectionTypes";
import { formatErrorMessage } from "../formatErrorMessage";
import { resolveActiveDriverId } from "../sql/sqlDialect";
import { QueryExecutionService } from "./queryExecutionService";
import { QueryResultDirtyService } from "./queryResultDirtyService";
import { buildUpdateStatements } from "./safeUpdateSql";
import { assertReadOnlyQueryAllowed } from "./sqlGuard";
import { parseSingleTableFromSelect } from "./sqlTableReference";

export type UpdateEligibility =
  | {
      eligible: true;
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
};

function resolveExplicitSchemaName(
  tableRef: { schema: string | null; table: string },
  driverId: ConnectionDriverId,
): string {
  if (tableRef.schema?.trim()) {
    return tableRef.schema.trim();
  }

  const profile = ConnectionService.getConnectedProfile();
  if (!profile) {
    return "";
  }

  const driver = getConnectionDriver(driverId);
  if (!driver.showSchemaField) {
    return profile.catalog.trim() || profile.defaultSchema.trim();
  }

  return profile.defaultSchema.trim() || profile.catalog.trim();
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

export async function resolveUpdateEligibility(
  sql: string,
  resultColumns: string[],
  options?: { relationKind?: "table" | "view" },
): Promise<UpdateEligibility> {
  if (!isTauri()) {
    return {
      eligible: false,
      reason: tKey("app.query.saveDesktopOnly"),
    };
  }

  if (options?.relationKind === "view") {
    return {
      eligible: false,
      reason: tKey("app.query.saveViewsReadonly"),
    };
  }

  if (!ConnectionService.isConnected()) {
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

  const driverId = resolveActiveDriverId();
  const explicitSchema = resolveExplicitSchemaName(tableRef, driverId);

  let payload;
  try {
    payload = await bridgeListPrimaryKeys(explicitSchema, tableRef.table);
  } catch (error) {
    return {
      eligible: false,
      reason: formatErrorMessage(error, "Failed to load primary key metadata."),
    };
  }

  if (payload.keys.length === 0) {
    const label = explicitSchema
      ? `${explicitSchema}.${tableRef.table}`
      : tableRef.table;
    return {
      eligible: false,
      reason: `Table ${label} has no primary key. Updates are blocked for safety.`,
    };
  }

  const resolvedSchema = payload.schema?.trim() || explicitSchema || null;

  const primaryKeys: string[] = [];
  for (const key of payload.keys) {
    const resolved = resolveResultColumn(resultColumns, key.name);
    if (!resolved) {
      return {
        eligible: false,
        reason: `Primary key column "${key.name}" is not present in the result set. Include all PK columns in the SELECT list.`,
      };
    }
    primaryKeys.push(resolved);
  }

  return {
    eligible: true,
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
  options?: { relationKind?: "table" | "view" },
): Promise<UpdatePreview | { blocked: true; reason: string }> {
  const dirtyRows = QueryResultDirtyService.getDirtyRows(tabId);
  if (dirtyRows.length === 0) {
    return { blocked: true, reason: "No edited cells to save." };
  }

  const eligibility = await resolveUpdateEligibility(
    sql,
    resultColumns,
    options,
  );
  if (!eligibility.eligible) {
    return { blocked: true, reason: eligibility.reason };
  }

  const statements = buildUpdateStatements({
    schema: eligibility.schema,
    table: eligibility.table,
    driverId: eligibility.driverId,
    primaryKeys: eligibility.primaryKeys,
    originalRows: QueryResultDirtyService.getOriginalRows(tabId),
    dirtyRows,
  });

  const dirtyCellCount = QueryResultDirtyService.getDirtyCount(tabId);
  return {
    eligibility,
    statements,
    dirtyRowCount: dirtyRows.length,
    dirtyCellCount,
  };
}

export async function executeConfirmedUpdates(
  tabId: string,
  statements: string[],
): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  if (statements.length === 0) {
    return { ok: false, message: "No UPDATE statements to execute." };
  }

  try {
    for (const statement of statements) {
      assertReadOnlyQueryAllowed(statement, ConfigurationService.getValue("database.readOnly"));
      await QueryExecutionService.executeWriteStatement(statement);
    }

    await QueryExecutionService.refreshTabResult(tabId);
    QueryResultDirtyService.clearTab(tabId);
    const count = statements.length;
    return {
      ok: true,
      message: `${count} UPDATE statement${count === 1 ? "" : "s"} executed.`,
    };
  } catch (error) {
    return {
      ok: false,
      message: formatErrorMessage(error, "Failed to execute UPDATE statements."),
    };
  }
}

export function getSaveBlockedReason(
  sql: string,
  dirtyCount: number,
  options?: { relationKind?: "table" | "view" },
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

  if (ConfigurationService.getValue("database.readOnly")) {
    return tKey("app.query.saveReadOnlyShort");
  }

  if (!parseSingleTableFromSelect(sql)) {
    return tKey("app.query.saveSimpleSelectShort");
  }

  return null;
}
