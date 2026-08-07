import { EditorService } from "@silk-studio/editor/services/editor/editorServiceFacade.ts";
import {
  buildDdlTabLabel,
  ddlEditorUri,
} from "./ddlEditorConstants";
import type { ExplorerObjectRef } from "./explorerObjectActions";
import { monacoLanguageIdForDriver } from "../sql/sqlDialect";
import { ConnectionService } from "./connectionService";

export function openObjectDdl(ref: ExplorerObjectRef): void {
  const profile = ConnectionService.getProfile(ref.profileId);
  const languageId = profile
    ? monacoLanguageIdForDriver(profile.driverId)
    : "sql";

  const uri = ddlEditorUri({
    profileId: ref.profileId,
    schemaName: ref.schemaName,
    kind: ref.object.kind,
    objectName: ref.object.name,
  });

  const label = buildDdlTabLabel(ref.schemaName, ref.object.name);
  const tabId = EditorService.openEditor({
    uri,
    label,
    languageId,
    content: "-- Loading DDL...\n",
    preview: false,
  });
  EditorService.pinTab(tabId);
}
