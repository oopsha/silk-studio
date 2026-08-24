import { describe, expect, it } from "vitest";
import type { MetadataColumn } from "@silk-studio/db-protocol";
import { diffTableStructure, type EditableColumnDraft, type OriginalColumnRow } from "./tableStructureDiff";
import { buildTableStructureSaveSql, type TableStructureSaveSqlContext } from "./tableStructureSaveSql";
import type { ConnectionDriverId } from "./connectionTypes";

function col(overrides: Partial<MetadataColumn> & { name: string }): MetadataColumn {
  return { typeName: "VARCHAR", columnSize: 50, nullable: true, ...overrides };
}

function draft(overrides: Partial<EditableColumnDraft> & { rowId: string }): EditableColumnDraft {
  return {
    name: "COL",
    typeName: "VARCHAR",
    length: 50,
    nullable: true,
    defaultValue: null,
    comment: null,
    origin: null,
    ...overrides,
  };
}

function ctxFor(driverId: ConnectionDriverId, existingColumnCount = 1): TableStructureSaveSqlContext {
  return {
    driverId,
    schemaName: "APP",
    tableName: "T1",
    existingColumnCount,
  };
}

describe("buildTableStructureSaveSql — kitchen sink per dialect", () => {
  // One column dropped, one renamed+type changed, one add, plus table rename+comment.
  function kitchenSinkChanges(driverId: ConnectionDriverId) {
    const dropped: OriginalColumnRow = { rowId: "drop-1", column: col({ name: "OLD_COL", typeName: "VARCHAR", columnSize: 10 }) };
    const alteredOriginal: OriginalColumnRow = {
      rowId: "alt-1",
      column: col({ name: "ID", typeName: "NUMBER", columnSize: 10, nullable: false, comment: undefined, fullTypeName: "int(10)" }),
    };
    const original = [dropped, alteredOriginal];
    const edited: EditableColumnDraft[] = [
      draft({
        rowId: "alt-1",
        name: "ID_NEW",
        typeName: "NUMBER",
        length: 20,
        nullable: true,
        defaultValue: "0",
        comment: "the id",
        origin: alteredOriginal.column,
      }),
      draft({ rowId: "add-1", name: "NEW_COL", typeName: "VARCHAR", length: 30, nullable: false, defaultValue: "'x'" }),
    ];

    return diffTableStructure({
      driverId,
      originalColumns: original,
      editedColumns: edited,
      originalTableName: "T1",
      editedTableName: "T2",
      originalTableComment: null,
      editedTableComment: "renamed table",
    });
  }

  it("Oracle: drop, rename column, MODIFY combining type+null+default, comment, add, table comment, table rename — in that order", () => {
    const changes = kitchenSinkChanges("oracle");
    const result = buildTableStructureSaveSql(changes, ctxFor("oracle", 2));
    expect(result.blockers).toEqual([]);
    expect(result.statements).toEqual([
      'ALTER TABLE "APP"."T1" DROP COLUMN "OLD_COL"',
      'ALTER TABLE "APP"."T1" RENAME COLUMN "ID" TO "ID_NEW"',
      'ALTER TABLE "APP"."T1" MODIFY ("ID_NEW" NUMBER(20) DEFAULT 0 NULL)',
      'ALTER TABLE "APP"."T1" ADD ("NEW_COL" VARCHAR(30) DEFAULT \'x\' NOT NULL)',
      'COMMENT ON COLUMN "APP"."T1"."ID_NEW" IS \'the id\'',
      'COMMENT ON TABLE "APP"."T1" IS \'renamed table\'',
      'ALTER TABLE "APP"."T1" RENAME TO "T2"',
    ]);
  });

  it("PostgreSQL: separate ALTER COLUMN per property (type/null/default), separate comment", () => {
    const changes = kitchenSinkChanges("postgresql");
    const result = buildTableStructureSaveSql(changes, ctxFor("postgresql", 2));
    expect(result.statements).toEqual([
      'ALTER TABLE "APP"."T1" DROP COLUMN "OLD_COL"',
      'ALTER TABLE "APP"."T1" RENAME COLUMN "ID" TO "ID_NEW"',
      'ALTER TABLE "APP"."T1" ALTER COLUMN "ID_NEW" TYPE NUMBER(20)',
      'ALTER TABLE "APP"."T1" ALTER COLUMN "ID_NEW" DROP NOT NULL',
      'ALTER TABLE "APP"."T1" ALTER COLUMN "ID_NEW" SET DEFAULT 0',
      'ALTER TABLE "APP"."T1" ADD COLUMN "NEW_COL" VARCHAR(30) NOT NULL DEFAULT \'x\'',
      'COMMENT ON COLUMN "APP"."T1"."ID_NEW" IS \'the id\'',
      'COMMENT ON TABLE "APP"."T1" IS \'renamed table\'',
      'ALTER TABLE "APP"."T1" RENAME TO "T2"',
    ]);
  });

  it("MySQL: rename folds into a single CHANGE restating the full definition (using fullTypeName only when type untouched)", () => {
    const changes = kitchenSinkChanges("mysql");
    const result = buildTableStructureSaveSql(changes, ctxFor("mysql", 2));
    expect(result.statements).toEqual([
      "ALTER TABLE `APP`.`T1` DROP COLUMN `OLD_COL`",
      "ALTER TABLE `APP`.`T1` CHANGE `ID` `ID_NEW` NUMBER(20) NULL DEFAULT 0 COMMENT 'the id'",
      "ALTER TABLE `APP`.`T1` ADD COLUMN `NEW_COL` VARCHAR(30) NOT NULL DEFAULT 'x'",
      "ALTER TABLE `APP`.`T1` COMMENT = 'renamed table'",
      "ALTER TABLE `APP`.`T1` RENAME TO `T2`",
    ]);
  });

  it("SQL Server: sp_rename (literal args), separate ALTER COLUMN, extended-property comment, table rename", () => {
    const changes = kitchenSinkChanges("sqlserver");
    const result = buildTableStructureSaveSql(changes, ctxFor("sqlserver", 2));
    expect(result.statements).toEqual([
      "ALTER TABLE [APP].[T1] DROP COLUMN [OLD_COL]",
      "EXEC sp_rename N'APP.T1.ID', N'ID_NEW', 'COLUMN'",
      "ALTER TABLE [APP].[T1] ALTER COLUMN [ID_NEW] NUMBER(20) NULL",
      "ALTER TABLE [APP].[T1] ADD DEFAULT 0 FOR [ID_NEW]",
      "ALTER TABLE [APP].[T1] ADD [NEW_COL] VARCHAR(30) NOT NULL DEFAULT 'x'",
      "EXEC sp_addextendedproperty @name=N'MS_Description', @value=N'the id', @level0type=N'SCHEMA', @level0name=N'APP', @level1type=N'TABLE', @level1name=N'T1', @level2type=N'COLUMN', @level2name=N'ID_NEW'",
      "EXEC sp_addextendedproperty @name=N'MS_Description', @value=N'renamed table', @level0type=N'SCHEMA', @level0name=N'APP', @level1type=N'TABLE', @level1name=N'T1'",
      "EXEC sp_rename N'APP.T1', N'T2', 'OBJECT'",
    ]);
  });
});

describe("buildTableStructureSaveSql — ordering invariants", () => {
  it("table rename is always the last statement, regardless of dialect", () => {
    for (const driverId of ["oracle", "postgresql", "mysql", "mariadb", "sqlserver"] as ConnectionDriverId[]) {
      const changes = diffTableStructure({
        driverId,
        originalColumns: [],
        editedColumns: [],
        originalTableName: "T1",
        editedTableName: "T2",
        originalTableComment: null,
        editedTableComment: null,
      });
      const result = buildTableStructureSaveSql(changes, ctxFor(driverId, 0));
      expect(result.statements[result.statements.length - 1]).toMatch(/T2|'T2'/);
    }
  });

  it("drop precedes add", () => {
    const dropped: OriginalColumnRow = { rowId: "d1", column: col({ name: "A" }) };
    const changes = diffTableStructure({
      driverId: "oracle",
      originalColumns: [dropped],
      editedColumns: [draft({ rowId: "n1", name: "B" })],
      originalTableName: "T1",
      editedTableName: "T1",
      originalTableComment: null,
      editedTableComment: null,
    });
    const result = buildTableStructureSaveSql(changes, ctxFor("oracle", 1));
    const dropIdx = result.statements.findIndex((s) => s.includes("DROP COLUMN"));
    const addIdx = result.statements.findIndex((s) => s.includes("ADD"));
    expect(dropIdx).toBeGreaterThanOrEqual(0);
    expect(addIdx).toBeGreaterThan(dropIdx);
  });

  it("SQL Server: default-constraint drop precedes the ALTER COLUMN for the same column", () => {
    const original: OriginalColumnRow = {
      rowId: "r1",
      column: col({ name: "A", typeName: "INT", defaultValue: "0", defaultConstraintName: "DF_A" }),
    };
    const changes = diffTableStructure({
      driverId: "sqlserver",
      originalColumns: [original],
      editedColumns: [draft({ rowId: "r1", name: "A", typeName: "BIGINT", origin: original.column })],
      originalTableName: "T1",
      editedTableName: "T1",
      originalTableComment: null,
      editedTableComment: null,
    });
    const result = buildTableStructureSaveSql(changes, ctxFor("sqlserver", 1));
    const dropConstraintIdx = result.statements.findIndex((s) => s.includes("DROP CONSTRAINT"));
    const alterColumnIdx = result.statements.findIndex((s) => s.includes("ALTER COLUMN"));
    expect(dropConstraintIdx).toBeGreaterThanOrEqual(0);
    expect(alterColumnIdx).toBeGreaterThan(dropConstraintIdx);
  });
});

describe("buildTableStructureSaveSql — blockers", () => {
  it("blocks a SQL Server default change when defaultConstraintName is unknown", () => {
    const original: OriginalColumnRow = {
      rowId: "r1",
      column: col({ name: "A", defaultValue: "0" }), // no defaultConstraintName
    };
    const changes = diffTableStructure({
      driverId: "sqlserver",
      originalColumns: [original],
      editedColumns: [draft({ rowId: "r1", name: "A", defaultValue: "1", origin: original.column })],
      originalTableName: "T1",
      editedTableName: "T1",
      originalTableComment: null,
      editedTableComment: null,
    });
    const result = buildTableStructureSaveSql(changes, ctxFor("sqlserver", 1));
    expect(result.blockers.some((b) => b.includes("default"))).toBe(true);
  });

  it("blocks editing an identity/generated column", () => {
    const original: OriginalColumnRow = { rowId: "r1", column: col({ name: "ID", autoIncrement: true }) };
    const changes = diffTableStructure({
      driverId: "postgresql",
      originalColumns: [original],
      editedColumns: [draft({ rowId: "r1", name: "ID2", origin: original.column })],
      originalTableName: "T1",
      editedTableName: "T1",
      originalTableComment: null,
      editedTableComment: null,
    });
    const result = buildTableStructureSaveSql(changes, ctxFor("postgresql", 1));
    expect(result.blockers.length).toBeGreaterThan(0);
  });

  it("blocks a duplicate column name", () => {
    const originalA: OriginalColumnRow = { rowId: "a", column: col({ name: "A" }) };
    const originalB: OriginalColumnRow = { rowId: "b", column: col({ name: "B" }) };
    const changes = diffTableStructure({
      driverId: "oracle",
      originalColumns: [originalA, originalB],
      editedColumns: [
        draft({ rowId: "a", name: "SAME", origin: originalA.column }),
        draft({ rowId: "b", name: "SAME", origin: originalB.column }),
      ],
      originalTableName: "T1",
      editedTableName: "T1",
      originalTableComment: null,
      editedTableComment: null,
    });
    const result = buildTableStructureSaveSql(changes, ctxFor("oracle", 2));
    expect(result.blockers.some((b) => b.toLowerCase().includes("more than once"))).toBe(true);
  });

  it("blocks dropping every column", () => {
    const original: OriginalColumnRow = { rowId: "r1", column: col({ name: "A" }) };
    const changes = diffTableStructure({
      driverId: "oracle",
      originalColumns: [original],
      editedColumns: [],
      originalTableName: "T1",
      editedTableName: "T1",
      originalTableComment: null,
      editedTableComment: null,
    });
    const result = buildTableStructureSaveSql(changes, ctxFor("oracle", 1));
    expect(result.blockers.some((b) => b.toLowerCase().includes("every column"))).toBe(true);
  });
});

describe("buildTableStructureSaveSql — warnings", () => {
  it("warns when adding a NOT NULL column with no default", () => {
    const changes = diffTableStructure({
      driverId: "oracle",
      originalColumns: [],
      editedColumns: [draft({ rowId: "n1", name: "NEW", nullable: false, defaultValue: null })],
      originalTableName: "T1",
      editedTableName: "T1",
      originalTableComment: null,
      editedTableComment: null,
    });
    const result = buildTableStructureSaveSql(changes, ctxFor("oracle", 0));
    expect(result.warnings.some((w) => w.includes("NOT NULL"))).toBe(true);
  });

  it("warns on every dropped column", () => {
    const original: OriginalColumnRow = { rowId: "r1", column: col({ name: "GONE" }) };
    const changes = diffTableStructure({
      driverId: "oracle",
      originalColumns: [original],
      editedColumns: [],
      originalTableName: "T1",
      editedTableName: "T1",
      originalTableComment: null,
      editedTableComment: null,
    });
    const result = buildTableStructureSaveSql(changes, ctxFor("oracle", 1));
    expect(result.warnings.some((w) => w.includes("GONE"))).toBe(true);
  });
});
