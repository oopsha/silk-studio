import type { MetadataObject } from "@silk-studio/db-protocol";
import { CommandsRegistry } from "@silk-studio/workbench/platform/commands/commandRegistry.ts";
import { KeybindingsRegistry } from "@silk-studio/workbench/platform/keybinding/keybindingRegistry.ts";
import { I18nService } from "@silk-studio/workbench/platform/i18n/i18nService.ts";
import { AppNotificationService } from "@silk-studio/workbench/services/notifications/appNotificationService.ts";
import { EditorService } from "@silk-studio/editor/services/editor/editorServiceFacade.ts";
import { isDdlEditorTab } from "../../services/connection/ddlEditorConstants";
import { isObjectEditorTab } from "../../services/connection/objectEditorConstants";
import { openObjectDdl } from "../../services/connection/ddlEditorService";
import { openObjectEditor } from "../../services/connection/objectEditorService";
import type { ExplorerObjectRef } from "../../services/connection/explorerObjectActions";
import { isSqlLanguageId } from "../../services/sql/sqlDialect";
import {
  resolveIdentifierAtPosition,
  type ResolvedIdentifier,
} from "../../services/sql/sqlIdentifierAtPosition";
import {
  findObjectAcrossSchemas,
  getConnectedProfileIdForCompletion,
} from "../../services/sql/sqlCompletionCatalog";

const t = I18nService.t.bind(I18nService);

/**
 * Package members (PKG.MEMBER) aren't independently addressable objects — there's no
 * standalone DDL for just the member. So whenever the qualifier resolves to a package,
 * always show that package regardless of which segment the cursor was actually on.
 * Only when the qualifier is NOT a package do we treat it as a schema hint for `name`.
 */
async function resolveGoToDefinitionTarget(
  profileId: string,
  identifier: ResolvedIdentifier,
): Promise<{ schema: string; object: MetadataObject } | null> {
  if (identifier.qualifier) {
    const asPackage = await findObjectAcrossSchemas(profileId, identifier.qualifier);
    if (asPackage && asPackage.object.kind === "package") {
      return asPackage;
    }
    return findObjectAcrossSchemas(profileId, identifier.name, identifier.qualifier);
  }
  return findObjectAcrossSchemas(profileId, identifier.name);
}

CommandsRegistry.registerCommand("silk.editor.goToDefinition", async () => {
  if (!(document.activeElement instanceof HTMLElement)) return;
  if (!document.activeElement.closest(".monaco-editor")) return;

  const activeTab = EditorService.getActiveTab();
  if (!activeTab) return;
  if (isDdlEditorTab(activeTab.uri) || isObjectEditorTab(activeTab.uri)) return;
  if (!isSqlLanguageId(activeTab.languageId)) return;

  const instance = EditorService.getActiveTextEditor();
  const position = instance?.getPosition();
  const model = instance?.getModel();
  if (!position || !model) return;

  const identifier = resolveIdentifierAtPosition(model, position);
  if (!identifier) return;

  const profileId = getConnectedProfileIdForCompletion();
  if (!profileId) {
    AppNotificationService.show(t("app.query.noConnection"), "info");
    return;
  }

  const found = await resolveGoToDefinitionTarget(profileId, identifier);
  if (!found) {
    AppNotificationService.show(t("app.query.goToDefinitionNotFound"), "info");
    return;
  }

  const ref: ExplorerObjectRef = {
    profileId,
    schemaName: found.schema,
    object: found.object,
  };
  if (found.object.kind === "table" || found.object.kind === "view") {
    openObjectEditor(ref);
  } else {
    openObjectDdl(ref);
  }
});

KeybindingsRegistry.registerKeybinding("silk.editor.goToDefinition", "F4");
