import { EditorGroupsService } from "@silk-studio/editor/services/editor/editorGroupsService.ts";
import { GroupPanelStateService } from "@silk-studio/workbench/services/layout/groupPanelStateService.ts";
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

  if (!ConnectionService.isConnected(ref.profileId)) {
    await ConnectionService.connect(ref.profileId);
  }

  const sql = buildOpenDataSql(
    ref.schemaName,
    ref.object.name,
    profile.driverId,
  );
  const tabTitle = `${ref.schemaName}.${ref.object.name}`;

  GroupPanelStateService.showPanel(EditorGroupsService.getFocusedGroupId());
  await QueryExecutionService.execute(sql, {
    relationKind: ref.object.kind,
    tabTitle,
    connectionId: ref.profileId,
    ownerId: buildOpenDataOwnerId(
      ref.profileId,
      ref.schemaName,
      ref.object.name,
    ),
  });
}
