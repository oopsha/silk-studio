import type { MetadataObjectKind } from "@silk-studio/db-protocol";
import { EditorService } from "@silk-studio/editor/services/editor/editorService.ts";
import type { ConnectionDriverId } from "./connectionTypes";
import { ConnectionService } from "./connectionService";
import type { ExplorerObjectRef } from "./explorerObjectActions";
import {
  buildPlsqlTabLabel,
  PLSQL_SOURCE_LOADING,
  plsqlEditorUri,
} from "./plsqlEditorConstants";

export function isEditablePlsqlKind(kind: MetadataObjectKind): boolean {
  return kind === "procedure" || kind === "function" || kind === "package";
}

export function supportsPlsqlSourceEdit(
  driverId: ConnectionDriverId,
  kind: MetadataObjectKind,
): boolean {
  return driverId === "oracle" && isEditablePlsqlKind(kind);
}

export function openPlsqlObjectSource(ref: ExplorerObjectRef): void {
  const profile = ConnectionService.getProfile(ref.profileId);
  if (!profile) {
    throw new Error("Connection profile not found.");
  }

  if (!supportsPlsqlSourceEdit(profile.driverId, ref.object.kind)) {
    throw new Error(
      "Source editing is available for Oracle procedures, functions, and packages only.",
    );
  }

  const { connectedProfileId } = ConnectionService.getState();
  if (connectedProfileId !== ref.profileId || !ConnectionService.isConnected()) {
    throw new Error("Connect this profile before opening PL/SQL source.");
  }

  const uri = plsqlEditorUri({
    profileId: ref.profileId,
    schemaName: ref.schemaName,
    kind: ref.object.kind,
    objectName: ref.object.name,
  });

  const label = buildPlsqlTabLabel(
    ref.schemaName,
    ref.object.name,
    ref.object.kind,
  );

  const tabId = EditorService.openEditor({
    uri,
    label,
    languageId: "plsql",
    content: PLSQL_SOURCE_LOADING,
    preview: false,
  });
  EditorService.pinTab(tabId);
}
