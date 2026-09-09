import { EditorService } from "@silk-studio/editor/services/editor/editorServiceFacade.ts";
import { EditorConnectionBindingService } from "./editorConnectionBindingService";
import { ConnectionService } from "./connectionService";
import { monacoLanguageIdForDriver } from "../sql/sqlDialect";
import {
  buildCreateTableSql,
  type CreateTableTarget,
} from "./createTableSql";

export type { CreateTableTarget } from "./createTableSql";

export function openCreateTableSql(target: CreateTableTarget): void {
  const profile = ConnectionService.getProfile(target.profileId);
  if (!profile) {
    throw new Error("Connection profile was not found.");
  }

  const tabId = EditorService.openEditor({
    label: "New Table",
    languageId: monacoLanguageIdForDriver(profile.driverId),
    content: buildCreateTableSql(profile.driverId, target),
    preview: false,
  });
  EditorConnectionBindingService.setBinding(tabId, { profileId: target.profileId });
}
