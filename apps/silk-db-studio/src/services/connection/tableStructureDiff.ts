import type { MetadataColumn } from "@silk-studio/db-protocol";
import type { ConnectionDriverId } from "./connectionTypes";
import { formatColumnTypeParts } from "./tableColumnTypeFormat";

/**
 * One row of the table structure editor's grid. `rowId` is a client-only synthetic identifier
 * assigned the moment column metadata is loaded into the grid — it is never sent to the
 * database and has nothing to do with any DB-native column identifier. It stays stable across
 * edits (including renaming `name`) for the lifetime of one editing session, which is what lets
 * {@link diffTableStructure} tell "renamed column" apart from "dropped one, added another" —
 * matching by name would misclassify a plain rename as a drop+add and silently destroy data.
 */
export type EditableColumnDraft = {
  rowId: string;
  name: string;
  typeName: string;
  length?: number;
  scale?: number;
  nullable: boolean;
  defaultValue: string | null;
  comment: string | null;
  /** The original metadata this row was seeded from, or `null` for a newly added row. */
  origin: MetadataColumn | null;
  /** Set when the column is identity/generated — the editor keeps these rows read-only. */
  readOnlyReason?: "autoIncrement" | "generated";
};

export type FieldChange<T> = { before: T; after: T };

export type ColumnChange =
  | { op: "add"; rowId: string; column: EditableColumnDraft }
  | { op: "drop"; rowId: string; original: MetadataColumn }
  | {
      op: "alter";
      rowId: string;
      original: MetadataColumn;
      draft: EditableColumnDraft;
      renamed: FieldChange<string> | null;
      type: FieldChange<string> | null;
      nullable: FieldChange<boolean> | null;
      defaultValue: FieldChange<string | null> | null;
      comment: FieldChange<string | null> | null;
    };

export type TableStructureChangeSet = {
  tableRename: FieldChange<string> | null;
  tableComment: FieldChange<string | null> | null;
  columns: ColumnChange[];
  isEmpty: boolean;
};

export type OriginalColumnRow = { rowId: string; column: MetadataColumn };

export type DiffTableStructureInput = {
  driverId: ConnectionDriverId;
  originalColumns: OriginalColumnRow[];
  editedColumns: EditableColumnDraft[];
  originalTableName: string;
  editedTableName: string;
  originalTableComment: string | null;
  editedTableComment: string | null;
};

function normalizeText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Oracle folds unquoted identifiers to uppercase; every other supported dialect is case-sensitive. */
function identsEqual(a: string, b: string, driverId: ConnectionDriverId): boolean {
  if (driverId === "oracle") {
    return a.trim().toUpperCase() === b.trim().toUpperCase();
  }
  return a.trim() === b.trim();
}

function renderedType(
  typeName: string | undefined,
  length: number | undefined,
  scale: number | undefined,
): string {
  return formatColumnTypeParts(typeName, length, scale);
}

function fieldChange<T>(before: T, after: T, equal: (a: T, b: T) => boolean): FieldChange<T> | null {
  return equal(before, after) ? null : { before, after };
}

/**
 * Pure snapshot diff: compares the originally-fetched columns/table name/comment against the
 * user-edited grid state and classifies every change. See {@link EditableColumnDraft} for the
 * rowId-based matching rule this depends on. No I/O, no driver-specific SQL — only the
 * Oracle-identifier-folding rule is driver-aware.
 */
export function diffTableStructure(input: DiffTableStructureInput): TableStructureChangeSet {
  const {
    driverId,
    originalColumns,
    editedColumns,
    originalTableName,
    editedTableName,
    originalTableComment,
    editedTableComment,
  } = input;

  const originalByRowId = new Map<string, MetadataColumn>();
  for (const row of originalColumns) {
    originalByRowId.set(row.rowId, row.column);
  }

  const editedRowIds = new Set(editedColumns.map((column) => column.rowId));
  const columns: ColumnChange[] = [];

  for (const draft of editedColumns) {
    const original = draft.origin ?? originalByRowId.get(draft.rowId) ?? null;

    if (!original) {
      columns.push({ op: "add", rowId: draft.rowId, column: draft });
      continue;
    }

    const renamed = fieldChange(
      original.name,
      draft.name.trim(),
      (a, b) => identsEqual(a, b, driverId),
    );

    const beforeType = renderedType(original.typeName, original.columnSize, original.decimalDigits);
    const afterType = renderedType(draft.typeName, draft.length, draft.scale);
    const type = fieldChange(beforeType, afterType, (a, b) => a === b);

    const nullable = fieldChange(original.nullable ?? true, draft.nullable, (a, b) => a === b);

    const defaultValue = fieldChange(
      normalizeText(original.defaultValue),
      normalizeText(draft.defaultValue),
      (a, b) => a === b,
    );

    const comment = fieldChange(
      normalizeText(original.comment),
      normalizeText(draft.comment),
      (a, b) => a === b,
    );

    if (!renamed && !type && !nullable && !defaultValue && !comment) {
      continue; // no-op row
    }

    columns.push({
      op: "alter",
      rowId: draft.rowId,
      original,
      draft,
      renamed,
      type,
      nullable,
      defaultValue,
      comment,
    });
  }

  for (const row of originalColumns) {
    if (!editedRowIds.has(row.rowId)) {
      columns.push({ op: "drop", rowId: row.rowId, original: row.column });
    }
  }

  const tableRename = fieldChange(
    originalTableName,
    editedTableName.trim(),
    (a, b) => identsEqual(a, b, driverId),
  );
  const tableComment = fieldChange(
    normalizeText(originalTableComment),
    normalizeText(editedTableComment),
    (a, b) => a === b,
  );

  return {
    tableRename,
    tableComment,
    columns,
    isEmpty: columns.length === 0 && tableRename === null && tableComment === null,
  };
}
