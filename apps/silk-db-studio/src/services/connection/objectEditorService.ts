import { EditorService } from "@silk-studio/editor/services/editor/editorServiceFacade.ts";
import {
  buildObjectEditorTabLabel,
  objectEditorUri,
} from "./objectEditorConstants";
import type { ExplorerObjectRef } from "./explorerObjectActions";
import { monacoLanguageIdForDriver } from "../sql/sqlDialect";
import { ConnectionService } from "./connectionService";
import { EditorConnectionBindingService } from "./editorConnectionBindingService";
import { setObjectEditorSection, type ObjectEditorSection } from "./objectEditorSectionService";

export function openObjectEditor(ref: ExplorerObjectRef, section: ObjectEditorSection = "properties"): string {
  const profile = ConnectionService.getProfile(ref.profileId);
  const languageId = profile
    ? monacoLanguageIdForDriver(profile.driverId)
    : "sql";

  const uri = objectEditorUri({
    profileId: ref.profileId,
    schemaName: ref.schemaName,
    kind: ref.object.kind,
    objectName: ref.object.name,
    catalogName: ref.catalogName,
  });

  const label = buildObjectEditorTabLabel(ref.schemaName, ref.object.name);
  const tabId = EditorService.openEditor({
    uri,
    label,
    languageId,
    content: "",
    preview: false,
  });
  EditorService.pinTab(tabId);
  EditorConnectionBindingService.setBinding(tabId, { profileId: ref.profileId, catalog: ref.catalogName, schema: ref.schemaName });
  setObjectEditorSection(tabId, section);
  return tabId;
}
