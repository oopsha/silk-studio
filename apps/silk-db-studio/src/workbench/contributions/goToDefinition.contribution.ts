import type { editor } from "monaco-editor";
import type { MetadataObject } from "@silk-studio/db-protocol";
import { CommandsRegistry } from "@silk-studio/workbench/platform/commands/commandRegistry.ts";
import { KeybindingsRegistry } from "@silk-studio/workbench/platform/keybinding/keybindingRegistry.ts";
import { I18nService } from "@silk-studio/workbench/platform/i18n/i18nService.ts";
import { AppNotificationService } from "@silk-studio/workbench/services/notifications/appNotificationService.ts";
import { EditorService } from "@silk-studio/editor/services/editor/editorServiceFacade.ts";
import { openObjectDdl } from "../../services/connection/ddlEditorService";
import { openObjectEditor } from "../../services/connection/objectEditorService";
import {
  defaultObjectAction,
  type ExplorerObjectRef,
} from "../../services/connection/explorerObjectActions";
import { ConnectionService } from "../../services/connection/connectionService";
import { openPlsqlObjectSource } from "../../services/connection/plsqlEditorService";
import { findRegisteredMonacoInstanceAt } from "../../services/editor/monacoInstanceRegistry";
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

/**
 * `EditorService.getActiveTextEditor()` only reflects a *real* SQL editor tab — it's
 * populated by `EditorArea`'s own Monaco mount lifecycle, which is skipped entirely for
 * `renderAlternative` views (the standalone DDL preview, and the object editor's embedded
 * Properties→DDL section both mount their own local Monaco instance that never registers
 * with `EditorGroupsService`). Try that known-working path first, then fall back to the
 * app's own registry (`monacoInstanceRegistry.ts`) that those views register themselves
 * into — NOT Monaco's own `editor.getEditors()`, which can miss instances created through
 * a different `monaco-editor` module copy than whatever this file happens to import (a
 * real risk in a pnpm workspace where multiple packages each depend on `monaco-editor`).
 */
function findFocusedMonacoEditor(): editor.ICodeEditor | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return null;
  const activeEditorInstance = EditorService.getActiveTextEditor();
  if (activeEditorInstance?.getDomNode()?.contains(active)) {
    return activeEditorInstance;
  }
  return findRegisteredMonacoInstanceAt(active);
}

CommandsRegistry.registerCommand("silk.editor.goToDefinition", async () => {
  if (!(document.activeElement instanceof HTMLElement)) return;
  if (!document.activeElement.closest(".monaco-editor")) return;

  const activeTab = EditorService.getActiveTab();
  if (!activeTab) return;
  // DDL preview (standalone "View DDL" tab, or the object editor's own Properties→DDL
  // section) is a real, focusable Monaco instance too — letting F4 resolve identifiers
  // referenced in that DDL text (e.g. a FK's REFERENCES target) is exactly the point here,
  // not a recursion risk: it only ever opens/focuses a tab for a *different* resolved
  // object, the same reveal-by-uri behavior F4 already has everywhere else.
  if (!isSqlLanguageId(activeTab.languageId)) return;

  const instance = findFocusedMonacoEditor();
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

  // The lookup can take a few seconds (SSM-tunneled RDS, cold cache) — say so up front
  // rather than leaving F4 looking like it did nothing.
  AppNotificationService.show(t("app.query.goToDefinitionLookingUp"), "info", 20_000);

  // Try the tab's bound connection first (fast path, no ambiguity when only one profile has
  // the object), then fall back to every other connected profile — a bare identifier in SQL
  // carries no hint about which open connection it lives on, and the user has no way to tell
  // either without checking each one manually.
  const otherProfileIds = ConnectionService.getState().connectedProfileIds.filter(
    (id) => id !== profileId,
  );
  let resolvedProfileId = profileId;
  let found = await resolveGoToDefinitionTarget(profileId, identifier);
  for (const otherProfileId of otherProfileIds) {
    if (found) break;
    found = await resolveGoToDefinitionTarget(otherProfileId, identifier);
    if (found) resolvedProfileId = otherProfileId;
  }
  if (!found) {
    AppNotificationService.show(t("app.query.goToDefinitionNotFound"), "info");
    return;
  }
  AppNotificationService.dismiss();

  const ref: ExplorerObjectRef = {
    profileId: resolvedProfileId,
    schemaName: found.schema,
    object: found.object,
    catalogName: found.catalog,
  };

  // Mirror the Explorer's own double-click routing (defaultObjectAction) so F4 lands on the
  // same window: table/view → Object Editor, an Oracle procedure/function/package → the
  // editable PL/SQL source tab (compile/save/snapshot actions), everything else → read-only
  // DDL view.
  const driverId = ConnectionService.getProfile(resolvedProfileId)?.driverId;
  const action = defaultObjectAction(found.object.kind, driverId);
  if (action === "openObjectEditor") {
    openObjectEditor(ref);
  } else if (action === "openSource") {
    openPlsqlObjectSource(ref);
  } else {
    openObjectDdl(ref);
  }
});

KeybindingsRegistry.registerKeybinding("silk.editor.goToDefinition", "F4");
