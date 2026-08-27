import type { MetadataObjectKind } from "@silk-studio/db-protocol";
import { EditorService } from "@silk-studio/editor/services/editor/editorServiceFacade.ts";
import type { ConnectionDriverId } from "./connectionTypes";
import { ConnectionService } from "./connectionService";
import type { ExplorerObjectRef } from "./explorerObjectActions";
import {
  buildPlsqlTabLabel,
  PLSQL_SOURCE_LOADING,
  plsqlEditorUri,
  type PlsqlEditorRef,
} from "./plsqlEditorConstants";

export function isEditablePlsqlKind(kind: MetadataObjectKind): boolean {
  return (
    kind === "view" ||
    kind === "procedure" ||
    kind === "function" ||
    kind === "package" ||
    kind === "trigger"
  );
}

/**
 * Drivers that support the DDL editor's history/snapshot/reload/save/compare-save machinery
 * for VIEWS, TRIGGERS, and standalone PROCEDURES/FUNCTIONS. All five round-trip via some form
 * of replace: Oracle and PostgreSQL natively (Postgres routine source is `pg_get_functiondef`,
 * already `CREATE OR REPLACE FUNCTION/PROCEDURE`; view source is `pg_get_viewdef` wrapped in a
 * CREATE OR REPLACE header server-side; both dialects also support `CREATE OR REPLACE TRIGGER`
 * natively — Postgres since v14). SQL Server has no `CREATE OR REPLACE` at all for any of these
 * — its source (`sys.sql_modules.definition`) is already a full `CREATE ... AS ...` statement,
 * and `buildPlsqlSaveSql` rewrites the leading `CREATE` to `ALTER` for it instead (or leaves a
 * pre-normalized `CREATE OR ALTER` as-is — SQL Server has supported that since 2016 SP1).
 * MySQL/MariaDB views round-trip via `CREATE OR REPLACE VIEW` the same way, but procedures/
 * functions/triggers have no such syntax — those go through a `DROP IF EXISTS` + `CREATE` pair
 * instead (see `buildPlsqlSaveSql`'s MySQL/MariaDB branch; DBeaver's `MySQLProcedureManager`
 * does the same).
 *
 * Packages are Oracle-only — no other dialect here has an equivalent spec/body construct.
 */
const SOURCE_EDIT_DRIVERS = new Set<ConnectionDriverId>([
  "oracle",
  "postgresql",
  "mysql",
  "mariadb",
  "sqlserver",
]);

export function supportsPlsqlSourceEdit(
  driverId: ConnectionDriverId,
  kind: MetadataObjectKind,
): boolean {
  if (kind === "view" || kind === "procedure" || kind === "function" || kind === "trigger") {
    return SOURCE_EDIT_DRIVERS.has(driverId);
  }
  return driverId === "oracle" && isEditablePlsqlKind(kind);
}

export type OpenPlsqlSourceOptions = {
  /** For packages: true opens BODY tab; false/omit opens SPEC. */
  packageBody?: boolean;
};

export function openPlsqlObjectSource(
  ref: ExplorerObjectRef,
  options: OpenPlsqlSourceOptions = {},
): void {
  const profile = ConnectionService.getProfile(ref.profileId);
  if (!profile) {
    throw new Error("Connection profile not found.");
  }

  if (!supportsPlsqlSourceEdit(profile.driverId, ref.object.kind)) {
    throw new Error(
      "Source editing is available for Oracle procedures, functions, and packages only.",
    );
  }

  if (!ConnectionService.isConnected(ref.profileId)) {
    throw new Error("Connect this profile before opening PL/SQL source.");
  }

  const packageBody =
    ref.object.kind === "package" ? options.packageBody === true : undefined;

  const editorRef: PlsqlEditorRef = {
    profileId: ref.profileId,
    schemaName: ref.schemaName,
    kind: ref.object.kind,
    objectName: ref.object.name,
    packageBody,
    catalogName: ref.catalogName,
  };

  const uri = plsqlEditorUri(editorRef);
  const label = buildPlsqlTabLabel(
    ref.schemaName,
    ref.object.name,
    ref.object.kind,
    packageBody,
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
