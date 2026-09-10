import { EditorService } from "@silk-studio/editor/services/editor/editorServiceFacade.ts";
import { monacoLanguageIdForDriver } from "../sql/sqlDialect";
import { bridgeListColumns } from "./connectionBridge";
import { ConnectionService } from "./connectionService";
import { EditorConnectionBindingService } from "./editorConnectionBindingService";
import {
  buildCreateIndexSql,
  buildCreateTriggerSql,
} from "./createTableChildSql";
import type { ExplorerObjectRef } from "./explorerObjectActions";

function requireTable(ref: ExplorerObjectRef): void {
  if (ref.object.kind !== "table") {
    throw new Error("This action is available for tables only.");
  }
}

function bindTableTarget(tabId: string, ref: ExplorerObjectRef): void {
  EditorConnectionBindingService.setBinding(tabId, {
    profileId: ref.profileId,
    catalog: ref.catalogName,
    schema: ref.schemaName,
  });
}

export async function openCreateIndexSql(ref: ExplorerObjectRef): Promise<void> {
  requireTable(ref);
  const profile = ConnectionService.getProfile(ref.profileId);
  if (!profile) throw new Error("Connection profile was not found.");
  const columns = await bridgeListColumns(
    ref.profileId,
    ref.schemaName,
    ref.object.name,
    ref.catalogName ?? undefined,
  );
  const firstColumn = columns.columns[0]?.name;
  if (!firstColumn) throw new Error("The table has no columns to index.");
  const tabId = EditorService.openEditor({
    label: `New Index — ${ref.object.name}`,
    languageId: monacoLanguageIdForDriver(profile.driverId),
    content: buildCreateIndexSql(profile.driverId, {
      schemaName: ref.schemaName,
      tableName: ref.object.name,
      catalogName: ref.catalogName,
    }, firstColumn),
    preview: false,
  });
  bindTableTarget(tabId, ref);
}

export async function openCreateTriggerSql(ref: ExplorerObjectRef): Promise<void> {
  requireTable(ref);
  const profile = ConnectionService.getProfile(ref.profileId);
  if (!profile) throw new Error("Connection profile was not found.");
  const tabId = EditorService.openEditor({
    label: `New Trigger — ${ref.object.name}`,
    languageId: monacoLanguageIdForDriver(profile.driverId),
    content: buildCreateTriggerSql(profile.driverId, {
      schemaName: ref.schemaName,
      tableName: ref.object.name,
      catalogName: ref.catalogName,
    }),
    preview: false,
  });
  bindTableTarget(tabId, ref);
}
