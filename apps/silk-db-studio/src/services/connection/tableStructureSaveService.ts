import { ConfigurationService } from "@silk-studio/workbench/platform/configuration/configurationService.ts";
import { EditorService } from "@silk-studio/editor/services/editor/editorServiceFacade.ts";
import { AppNotificationService } from "@silk-studio/workbench/services/notifications/appNotificationService.ts";
import { tKey } from "@silk-studio/workbench/platform/i18n/activeLocale.ts";
import { formatErrorMessage } from "../formatErrorMessage";
import { QueryExecutionService } from "../query/queryExecutionService";
import { assertReadOnlyQueryAllowed } from "../query/sqlGuard";
import { driverAutoCommitsDdl } from "../sql/sqlDialect";
import { ConnectionService } from "./connectionService";
import { ConnectionTransactionService } from "./connectionTransactionService";
import { ConnectionTreeService } from "./connectionTreeService";
import { registerPendingDdlSave } from "./pendingDdlSaveService";
import {
  buildObjectEditorTabLabel,
  objectEditorUri,
  type ObjectEditorRef,
} from "./objectEditorConstants";
import { invalidateObjectPreviewCache } from "./objectPreviewCache";
import { supportsTableStructureEdit } from "./explorerObjectMutationSql";
import type { TableStructureChangeSet } from "./tableStructureDiff";
import { buildTableStructureSaveSql } from "./tableStructureSaveSql";
import { TableStructureSaveDialogService } from "./tableStructureSaveDialogService";

function assertSaveAllowed(ref: ObjectEditorRef): void {
  const readOnly = ConfigurationService.getValue("database.readOnly");
  if (readOnly) {
    throw new Error("Read-only mode is enabled. Table structure changes are blocked.");
  }
  if (!ConnectionService.isConnected(ref.profileId)) {
    throw new Error("Connect this profile before saving table structure changes.");
  }
}

export function getTableStructureSaveBlockedReason(ref: ObjectEditorRef): string | null {
  if (ConfigurationService.getValue("database.readOnly")) {
    return "Read-only mode is enabled. Table structure changes are blocked.";
  }
  if (!ConnectionService.isConnected(ref.profileId)) {
    return "Connect this profile before saving table structure changes.";
  }
  const profile = ConnectionService.getProfile(ref.profileId);
  if (!profile || !supportsTableStructureEdit(profile.driverId, ref.kind)) {
    return "Table structure editing is not supported for this connection/object type.";
  }
  return null;
}

/**
 * Builds the ALTER/COMMENT/sp_* statements for `changes` and opens the confirm dialog.
 * Returns whether the save actually happened (mirrors `openPlsqlSaveDialog`).
 */
export async function openTableStructureSaveDialog(
  tabId: string,
  ref: ObjectEditorRef,
  changes: TableStructureChangeSet,
  existingColumnCount: number,
): Promise<boolean> {
  assertSaveAllowed(ref);

  const profile = ConnectionService.getProfile(ref.profileId);
  if (!profile) {
    throw new Error("Connection profile not found.");
  }

  const { statements, warnings, blockers } = buildTableStructureSaveSql(changes, {
    driverId: profile.driverId,
    schemaName: ref.schemaName,
    tableName: ref.objectName,
    catalogName: ref.catalogName,
    existingColumnCount,
  });

  const readOnly = ConfigurationService.getValue("database.readOnly");
  for (const statement of statements) {
    assertReadOnlyQueryAllowed(statement, readOnly);
  }

  return TableStructureSaveDialogService.open({
    tabId,
    ref,
    objectLabel: buildObjectEditorTabLabel(ref.schemaName, ref.objectName),
    changes,
    sql: statements.length > 0 ? `${statements.join(";\n\n")};` : "",
    statements,
    warnings,
    blockers,
  });
}

/**
 * Executes the confirmed statements sequentially — ordering is load-bearing here (drops must
 * precede adds, SQL Server default-constraint drops must precede the ALTER COLUMN that follows,
 * table rename is always last) — see `buildTableStructureSaveSql`'s ordering comment.
 */
export async function executeTableStructureSave(
  tabId: string,
  ref: ObjectEditorRef,
  statements: string[],
  changes: TableStructureChangeSet,
): Promise<void> {
  assertSaveAllowed(ref);
  const readOnly = ConfigurationService.getValue("database.readOnly");
  for (const statement of statements) {
    assertReadOnlyQueryAllowed(statement, readOnly);
  }

  const profile = ConnectionService.getProfile(ref.profileId);
  if (!profile) {
    throw new Error("Connection profile not found.");
  }

  for (let index = 0; index < statements.length; index += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop -- must run in exact array order, not in parallel.
      await QueryExecutionService.executeWriteStatement(statements[index], {
        connectionId: ref.profileId,
      });
    } catch (error) {
      const message = formatErrorMessage(
        error,
        `Failed to execute statement ${index + 1} of ${statements.length}.`,
      );
      if (index > 0) {
        const committedNote = driverAutoCommitsDdl(profile.driverId)
          ? " and are already committed"
          : "";
        throw new Error(
          `${message} Statements 1-${index} already ran${committedNote} — see the SQL tab for what ran and what didn't.`,
        );
      }
      throw new Error(message);
    }
  }

  await ConnectionTreeService.invalidateAndRefreshSchema(
    ref.profileId,
    ref.schemaName,
    ref.catalogName ?? undefined,
  );
  invalidateObjectPreviewCache(ref.profileId, ref.schemaName, ref.objectName);

  const newTableName = changes.tableRename?.after ?? null;
  const finalize = () => {
    if (!newTableName) return;
    const newRef: ObjectEditorRef = { ...ref, objectName: newTableName };
    const stillOpen = EditorService.getTabs().find((item) => item.id === tabId);
    if (stillOpen) {
      EditorService.markTabSaved(
        tabId,
        objectEditorUri(newRef),
        buildObjectEditorTabLabel(ref.schemaName, newTableName),
      );
    }
  };

  if (
    !driverAutoCommitsDdl(profile.driverId) &&
    ConnectionTransactionService.isDirty(ref.profileId)
  ) {
    registerPendingDdlSave(ref.profileId, {
      onCommit: finalize,
      onRollback: () => {
        AppNotificationService.show(tKey("app.plsql.saveRolledBack"), "info");
      },
    });
    AppNotificationService.show(tKey("app.plsql.savePendingCommit"), "info");
  } else {
    finalize();
    AppNotificationService.show(tKey("app.plsql.saveSucceeded"), "success");
  }
}

export function formatTableStructureSaveError(error: unknown, fallback: string): string {
  return formatErrorMessage(error, fallback);
}
