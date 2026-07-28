import { LayoutService } from "@silk-studio/workbench/services/layout/layoutService.ts";
import type { ConnectionDriverId } from "./connectionTypes";
import { ConnectionService } from "./connectionService";
import type { ExplorerObjectRef } from "./explorerObjectActions";
import { formatTableReference } from "../query/sqlLiteral";
import { QueryExecutionService } from "../query/queryExecutionService";

export function buildOpenDataSql(
  schemaName: string,
  objectName: string,
  driverId: ConnectionDriverId,
): string {
  const tableRef = formatTableReference(schemaName, objectName, driverId);
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

  const { connectedProfileId } = ConnectionService.getState();
  if (connectedProfileId !== ref.profileId || !ConnectionService.isConnected()) {
    await ConnectionService.connect(ref.profileId);
  }

  const sql = buildOpenDataSql(
    ref.schemaName,
    ref.object.name,
    profile.driverId,
  );
  const tabTitle = `${ref.schemaName}.${ref.object.name}`;

  LayoutService.showPanel();
  await QueryExecutionService.execute(sql, {
    relationKind: ref.object.kind,
    tabTitle,
  });
}
