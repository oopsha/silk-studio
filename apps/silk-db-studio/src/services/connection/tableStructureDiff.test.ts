import { describe, expect, it } from "vitest";
import type { MetadataColumn } from "@silk-studio/db-protocol";
import {
  diffTableStructure,
  type EditableColumnDraft,
  type OriginalColumnRow,
} from "./tableStructureDiff";

function col(overrides: Partial<MetadataColumn> & { name: string }): MetadataColumn {
  return { typeName: "VARCHAR2", columnSize: 50, nullable: true, ...overrides };
}

function draft(overrides: Partial<EditableColumnDraft> & { rowId: string }): EditableColumnDraft {
  return {
    name: "COL",
    typeName: "VARCHAR2",
    length: 50,
    nullable: true,
    defaultValue: null,
    comment: null,
    origin: null,
    ...overrides,
  };
}

const baseInput = {
  driverId: "oracle" as const,
  originalTableName: "MY_TABLE",
  editedTableName: "MY_TABLE",
  originalTableComment: null,
  editedTableComment: null,
};

describe("diffTableStructure", () => {
  it("classifies an untouched grid as isEmpty", () => {
    const original: OriginalColumnRow = { rowId: "r1", column: col({ name: "A" }) };
    const result = diffTableStructure({
      ...baseInput,
      originalColumns: [original],
      editedColumns: [draft({ rowId: "r1", name: "A", origin: original.column })],
    });
    expect(result.isEmpty).toBe(true);
    expect(result.columns).toEqual([]);
  });

  it("classifies a brand-new row (no matching original) as add", () => {
    const result = diffTableStructure({
      ...baseInput,
      originalColumns: [],
      editedColumns: [draft({ rowId: "new-1", name: "NEW_COL" })],
    });
    expect(result.columns).toEqual([
      { op: "add", rowId: "new-1", column: expect.objectContaining({ name: "NEW_COL" }) },
    ]);
  });

  it("classifies a row whose rowId vanished from the edited set as drop", () => {
    const original: OriginalColumnRow = { rowId: "r1", column: col({ name: "A" }) };
    const result = diffTableStructure({
      ...baseInput,
      originalColumns: [original],
      editedColumns: [],
    });
    expect(result.columns).toEqual([
      { op: "drop", rowId: "r1", original: original.column },
    ]);
  });

  it("classifies a name-only edit on the same rowId as rename, never drop+add", () => {
    const original: OriginalColumnRow = { rowId: "r1", column: col({ name: "SET_ITEM_CD" }) };
    const result = diffTableStructure({
      ...baseInput,
      originalColumns: [original],
      editedColumns: [
        draft({ rowId: "r1", name: "SETTING_CD", origin: original.column }),
      ],
    });
    expect(result.columns).toHaveLength(1);
    const change = result.columns[0];
    expect(change.op).toBe("alter");
    if (change.op === "alter") {
      expect(change.renamed).toEqual({ before: "SET_ITEM_CD", after: "SETTING_CD" });
      expect(change.type).toBeNull();
    }
  });

  it("classifies dropping column X and adding a new column also named X as drop+add, never modify", () => {
    const original: OriginalColumnRow = { rowId: "r1", column: col({ name: "X", typeName: "NUMBER" }) };
    const result = diffTableStructure({
      ...baseInput,
      originalColumns: [original],
      editedColumns: [draft({ rowId: "new-1", name: "X", typeName: "VARCHAR2" })],
    });
    expect(result.columns).toEqual(
      expect.arrayContaining([
        { op: "drop", rowId: "r1", original: original.column },
        expect.objectContaining({ op: "add", rowId: "new-1" }),
      ]),
    );
    expect(result.columns).toHaveLength(2);
  });

  it("detects a simultaneous rename and type change on the same row", () => {
    const original: OriginalColumnRow = {
      rowId: "r1",
      column: col({ name: "OLD_NAME", typeName: "VARCHAR2", columnSize: 50 }),
    };
    const result = diffTableStructure({
      ...baseInput,
      originalColumns: [original],
      editedColumns: [
        draft({ rowId: "r1", name: "NEW_NAME", typeName: "VARCHAR2", length: 100, origin: original.column }),
      ],
    });
    const change = result.columns[0];
    expect(change.op).toBe("alter");
    if (change.op === "alter") {
      expect(change.renamed).toEqual({ before: "OLD_NAME", after: "NEW_NAME" });
      expect(change.type).toEqual({ before: "VARCHAR2(50)", after: "VARCHAR2(100)" });
    }
  });

  it("treats a whitespace-only comment edit as no change", () => {
    const original: OriginalColumnRow = { rowId: "r1", column: col({ name: "A", comment: undefined }) };
    const result = diffTableStructure({
      ...baseInput,
      originalColumns: [original],
      editedColumns: [draft({ rowId: "r1", name: "A", comment: "   ", origin: original.column })],
    });
    expect(result.isEmpty).toBe(true);
  });

  it("treats an emptied default value as DROP DEFAULT (non-empty before, null after)", () => {
    const original: OriginalColumnRow = {
      rowId: "r1",
      column: col({ name: "A", defaultValue: "0" }),
    };
    const result = diffTableStructure({
      ...baseInput,
      originalColumns: [original],
      editedColumns: [draft({ rowId: "r1", name: "A", defaultValue: null, origin: original.column })],
    });
    const change = result.columns[0];
    expect(change.op).toBe("alter");
    if (change.op === "alter") {
      expect(change.defaultValue).toEqual({ before: "0", after: null });
    }
  });

  it("preserves a literal empty-string default rather than collapsing it to null", () => {
    const original: OriginalColumnRow = {
      rowId: "r1",
      column: col({ name: "A", defaultValue: undefined }),
    };
    const result = diffTableStructure({
      ...baseInput,
      originalColumns: [original],
      editedColumns: [draft({ rowId: "r1", name: "A", defaultValue: "''", origin: original.column })],
    });
    const change = result.columns[0];
    expect(change.op).toBe("alter");
    if (change.op === "alter") {
      expect(change.defaultValue).toEqual({ before: null, after: "''" });
    }
  });

  it("folds identifier case for Oracle when comparing renames (no spurious rename)", () => {
    const original: OriginalColumnRow = { rowId: "r1", column: col({ name: "MY_COL" }) };
    const result = diffTableStructure({
      ...baseInput,
      driverId: "oracle",
      originalColumns: [original],
      editedColumns: [draft({ rowId: "r1", name: "my_col", origin: original.column })],
    });
    expect(result.isEmpty).toBe(true);
  });

  it("is case-sensitive for PostgreSQL identifiers (lowercase-vs-uppercase is a real rename)", () => {
    const original: OriginalColumnRow = { rowId: "r1", column: col({ name: "my_col" }) };
    const result = diffTableStructure({
      ...baseInput,
      driverId: "postgresql",
      originalColumns: [original],
      editedColumns: [draft({ rowId: "r1", name: "MY_COL", origin: original.column })],
    });
    expect(result.isEmpty).toBe(false);
    const change = result.columns[0];
    expect(change.op).toBe("alter");
    if (change.op === "alter") {
      expect(change.renamed).toEqual({ before: "my_col", after: "MY_COL" });
    }
  });

  it("detects a table rename and table comment change independently of column changes", () => {
    const result = diffTableStructure({
      ...baseInput,
      editedTableName: "NEW_TABLE",
      editedTableComment: "a comment",
      originalColumns: [],
      editedColumns: [],
    });
    expect(result.tableRename).toEqual({ before: "MY_TABLE", after: "NEW_TABLE" });
    expect(result.tableComment).toEqual({ before: null, after: "a comment" });
    expect(result.isEmpty).toBe(false);
  });

  it("isEmpty becomes true again after edits are reverted back to the original values", () => {
    const original: OriginalColumnRow = { rowId: "r1", column: col({ name: "A" }) };
    const edited = draft({ rowId: "r1", name: "B", origin: original.column });
    const reverted = { ...edited, name: "A" };
    const result = diffTableStructure({
      ...baseInput,
      originalColumns: [original],
      editedColumns: [reverted],
    });
    expect(result.isEmpty).toBe(true);
  });
});
