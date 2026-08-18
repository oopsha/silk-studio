import type { ConnectionDriverId } from "./connectionTypes";
import { ConnectionService } from "./connectionService";
import type { ExplorerObjectRef } from "./explorerObjectActions";
import { formatTableReference } from "../query/sqlLiteral";
import {
  buildOpenDataOwnerId,
  QueryExecutionService,
} from "../query/queryExecutionService";

export function buildOpenDataSql(
  schemaName: string,
  objectName: string,
  driverId: ConnectionDriverId,
  catalogName?: string | null,
): string {
  const tableRef = formatTableReference(schemaName, objectName, driverId, catalogName);
  return `SELECT * FROM ${tableRef}`;
}

export async function openTableData(ref: ExplorerObjectRef): Promise<void> {
  if (ref.object.kind !== "table" && ref.object.kind !== "view") {
    throw new Error("Open Data is only available for tables and views.");
  }

  const profile = ConnectionService.getProfile(ref.profileId);
  if (!profile) {
    throw new Error("Connection profile not found.");
  }

  if (!ConnectionService.isConnected(ref.profileId)) {
    await ConnectionService.connect(ref.profileId);
  }

  // A 3-part reference (catalog.schema.table) resolves correctly against another database
  // without switching the shared session's current catalog — see sqlLiteral.ts.
  const sql = buildOpenDataSql(
    ref.schemaName,
    ref.object.name,
    profile.driverId,
    ref.catalogName,
  );
  const tabTitle = ref.catalogName?.trim()
    ? `${ref.catalogName.trim()}.${ref.schemaName}.${ref.object.name}`
    : `${ref.schemaName}.${ref.object.name}`;

  await QueryExecutionService.execute(sql, {
    relationKind: ref.object.kind,
    tabTitle,
    connectionId: ref.profileId,
    ownerId: buildOpenDataOwnerId(
      ref.profileId,
      ref.schemaName,
      ref.object.name,
      ref.catalogName,
    ),
  });
}
