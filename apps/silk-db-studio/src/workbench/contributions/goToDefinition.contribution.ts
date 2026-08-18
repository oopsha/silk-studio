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
 *
 * `identifier.database` (SQL Server `db.schema.table`) is passed straight through to
 * {@link findObjectAcrossSchemas}, which loads that catalog's schemas on demand without
 * switching the connection's session catalog — see sqlCompletionCatalog.ts.
 */
async function resolveGoToDefinitionTarget(
  profileId: string,
  identifier: ResolvedIdentifier,
): Promise<{ schema: string; object: MetadataObject; catalog: string | null } | null> {
  const catalog = identifier.database?.trim() || null;
  if (identifier.qualifier) {
    const asPackage = await findObjectAcrossSchemas(
      profileId,
      identifier.qualifier,
      null,
      catalog,
    );
    if (asPackage && asPackage.object.kind === "package") {
      return { ...asPackage, catalog };
    }
    const found = await findObjectAcrossSchemas(
      profileId,
      identifier.name,
      identifier.qualifier,
      catalog,
    );
    return found ? { ...found, catalog } : null;
  }
  const found = await findObjectAcrossSchemas(profileId, identifier.name, null, catalog);
  return found ? { ...found, catalog } : null;
}

/**
 * `identifier.database` can itself contain dots for a 4-part linked-server reference
 * (`server.db.schema.table`) — out of scope, so report it instead of misinterpreting the
 * server name as a database name.
 */
function unsupportedDatabaseSegment(identifier: ResolvedIdentifier): string | null {
  return identifier.database?.includes(".") ? identifier.database : null;
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

  const unsupportedDatabase = unsupportedDatabaseSegment(identifier);
  if (unsupportedDatabase) {
    AppNotificationService.show(
      t("app.query.goToDefinitionOtherDatabase").replace(
        "{database}",
        unsupportedDatabase,
      ),
      "info",
    );
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
    catalogName: found.catalog,
  };
  if (found.object.kind === "table" || found.object.kind === "view") {
    openObjectEditor(ref);
  } else {
    openObjectDdl(ref);
  }
});

KeybindingsRegistry.registerKeybinding("silk.editor.goToDefinition", "F4");
