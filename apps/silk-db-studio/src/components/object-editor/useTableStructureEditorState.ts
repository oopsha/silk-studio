import { useCallback, useEffect, useMemo, useState } from "react";
import type { MetadataColumn } from "@silk-studio/db-protocol";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import {
  bridgeGetTableComment,
  bridgeListColumns,
} from "../../services/connection/connectionBridge";
import { bridgeListPrimaryKeys } from "../../services/connection/connectionPrimaryKeysBridge";
import { formatErrorMessage } from "../../services/formatErrorMessage";
import type { ObjectEditorRef } from "../../services/connection/objectEditorConstants";
import type { ConnectionDriverId } from "../../services/connection/connectionTypes";
import {
  diffTableStructure,
  type EditableColumnDraft,
  type OriginalColumnRow,
  type TableStructureChangeSet,
} from "../../services/connection/tableStructureDiff";
import {
  getTableStructureSaveBlockedReason,
  openTableStructureSaveDialog,
} from "../../services/connection/tableStructureSaveService";

type LoadStatus = "loading" | "error" | "ready";

/**
 * All state and actions for the table structure editor — shared by {@link TableStructureEditor}
 * (the Columns tab's grid: Add Column + per-row edits) and {@link ObjectEditorHeader} (table
 * name/comment fields + Save/Discard/Refresh, which act on the table as a whole regardless of
 * which Properties section is active). Lives in one hook, owned by `PropertiesView`, so both
 * consumers share one diff/dirty state instead of racing two independent copies.
 */
export type TableStructureEditorState = {
  status: LoadStatus;
  errorMessage: string | null;
  driverId: ConnectionDriverId;
  editedColumns: EditableColumnDraft[];
  primaryKeyNames: Set<string>;
  pendingDeleteRowIds: Set<string>;
  editedTableName: string;
  editedTableComment: string | null;
  changes: TableStructureChangeSet;
  isDirty: boolean;
  blockedReason: string | null;
  setEditedTableName: (name: string) => void;
  setEditedTableComment: (comment: string | null) => void;
  updateColumn: (rowId: string, patch: Partial<EditableColumnDraft>) => void;
  addColumn: () => void;
  toggleDrop: (draft: EditableColumnDraft) => void;
  discard: () => void;
  refresh: () => void;
  save: () => Promise<void>;
};

function draftFromColumn(rowId: string, column: MetadataColumn): EditableColumnDraft {
  return {
    rowId,
    name: column.name,
    typeName: column.typeName ?? "",
    length: column.columnSize,
    scale: column.decimalDigits,
    nullable: column.nullable ?? true,
    defaultValue: column.defaultValue ?? null,
    comment: column.comment ?? null,
    origin: column,
    readOnlyReason: column.autoIncrement
      ? "autoIncrement"
      : column.generated
        ? "generated"
        : undefined,
  };
}

function newColumnDraft(): EditableColumnDraft {
  return {
    rowId: crypto.randomUUID(),
    name: "",
    typeName: "",
    length: undefined,
    scale: undefined,
    nullable: true,
    defaultValue: null,
    comment: null,
    origin: null,
  };
}

export type UseTableStructureEditorStateParams = {
  objectRef: ObjectEditorRef;
  tabId: string;
  driverId: ConnectionDriverId | undefined;
  /** False when this object/driver combination doesn't support structure editing — no fetch happens. */
  enabled: boolean;
};

/** Returns `undefined` when `enabled` is false or the driver isn't known yet. */
export function useTableStructureEditorState(
  params: UseTableStructureEditorStateParams,
): TableStructureEditorState | undefined {
  const { objectRef, tabId, driverId, enabled } = params;
  const { t } = useI18n();

  const [status, setStatus] = useState<LoadStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [originalColumns, setOriginalColumns] = useState<OriginalColumnRow[]>([]);
  const [primaryKeyNames, setPrimaryKeyNames] = useState<Set<string>>(new Set());
  const [editedColumns, setEditedColumns] = useState<EditableColumnDraft[]>([]);
  const [pendingDeleteRowIds, setPendingDeleteRowIds] = useState<Set<string>>(new Set());

  const [originalTableComment, setOriginalTableComment] = useState<string | null>(null);
  const [editedTableName, setEditedTableName] = useState(objectRef.objectName);
  const [editedTableComment, setEditedTableComment] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setStatus("loading");
    try {
      const [columnsResult, primaryKeysResult, commentResult] = await Promise.all([
        bridgeListColumns(
          objectRef.profileId,
          objectRef.schemaName,
          objectRef.objectName,
          objectRef.catalogName ?? undefined,
        ),
        bridgeListPrimaryKeys(
          objectRef.profileId,
          objectRef.schemaName,
          objectRef.objectName,
          objectRef.catalogName ?? undefined,
        ),
        bridgeGetTableComment(
          objectRef.profileId,
          objectRef.schemaName,
          objectRef.objectName,
          objectRef.catalogName ?? undefined,
        ).catch(() => ({ comment: undefined })),
      ]);

      const rows: OriginalColumnRow[] = [];
      const drafts: EditableColumnDraft[] = [];
      for (const column of columnsResult.columns) {
        const rowId = crypto.randomUUID();
        rows.push({ rowId, column });
        drafts.push(draftFromColumn(rowId, column));
      }

      setOriginalColumns(rows);
      setEditedColumns(drafts);
      setPendingDeleteRowIds(new Set());
      setPrimaryKeyNames(new Set(primaryKeysResult.keys.map((key) => key.name.toLowerCase())));
      setOriginalTableComment(commentResult.comment ?? null);
      setEditedTableName(objectRef.objectName);
      setEditedTableComment(commentResult.comment ?? null);
      setStatus("ready");
    } catch (error) {
      setErrorMessage(formatErrorMessage(error, t("app.columns.loadFailed")));
      setStatus("error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objectRef.profileId, objectRef.schemaName, objectRef.objectName, objectRef.catalogName]);

  useEffect(() => {
    if (!enabled || !driverId) return;
    void load();
  }, [enabled, driverId, load]);

  const visibleEditedColumns = useMemo(
    () => editedColumns.filter((c) => !pendingDeleteRowIds.has(c.rowId)),
    [editedColumns, pendingDeleteRowIds],
  );

  const changes = useMemo<TableStructureChangeSet>(() => {
    if (!driverId) {
      return { tableRename: null, tableComment: null, columns: [], isEmpty: true };
    }
    return diffTableStructure({
      driverId,
      originalColumns,
      editedColumns: visibleEditedColumns,
      originalTableName: objectRef.objectName,
      editedTableName,
      originalTableComment,
      editedTableComment,
    });
  }, [
    driverId,
    originalColumns,
    visibleEditedColumns,
    objectRef.objectName,
    editedTableName,
    originalTableComment,
    editedTableComment,
  ]);

  const isDirty = !changes.isEmpty;
  const blockedReason = getTableStructureSaveBlockedReason(objectRef);

  const updateColumn = useCallback((rowId: string, patch: Partial<EditableColumnDraft>): void => {
    setEditedColumns((prev) =>
      prev.map((draft) => (draft.rowId === rowId ? { ...draft, ...patch } : draft)),
    );
  }, []);

  const toggleDrop = useCallback((draft: EditableColumnDraft): void => {
    if (draft.origin === null) {
      setEditedColumns((prev) => prev.filter((d) => d.rowId !== draft.rowId));
      return;
    }
    setPendingDeleteRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(draft.rowId)) {
        next.delete(draft.rowId);
      } else {
        next.add(draft.rowId);
      }
      return next;
    });
  }, []);

  const addColumn = useCallback((): void => {
    setEditedColumns((prev) => [...prev, newColumnDraft()]);
  }, []);

  const discardOrRefresh = useCallback(() => {
    if (isDirty && !window.confirm(t("app.tableStructure.discard") + "?")) {
      return;
    }
    void load();
  }, [isDirty, load, t]);

  const save = useCallback(async (): Promise<void> => {
    try {
      const saved = await openTableStructureSaveDialog(
        tabId,
        objectRef,
        changes,
        originalColumns.length,
      );
      if (saved) {
        await load();
      }
    } catch (error) {
      window.alert(formatErrorMessage(error, t("app.tableStructure.saveFailed")));
    }
  }, [tabId, objectRef, changes, originalColumns.length, load, t]);

  if (!enabled || !driverId) {
    return undefined;
  }

  return {
    status,
    errorMessage,
    driverId,
    editedColumns,
    primaryKeyNames,
    pendingDeleteRowIds,
    editedTableName,
    editedTableComment,
    changes,
    isDirty,
    blockedReason,
    setEditedTableName,
    setEditedTableComment,
    updateColumn,
    addColumn,
    toggleDrop,
    discard: discardOrRefresh,
    refresh: discardOrRefresh,
    save,
  };
}
