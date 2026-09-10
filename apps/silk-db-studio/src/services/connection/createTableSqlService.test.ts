import { describe, expect, it } from "vitest";
import {
  buildCreateTableDraftSql,
  buildCreateTableDraftStatements,
  buildCreateTableSql,
  suggestCopiedTableName,
} from "./createTableSql";

describe("suggestCopiedTableName", () => {
  it("uses the conventional Copy suffix and increments it on collision", () => {
    expect(suggestCopiedTableName("ORDERS", [])).toBe("ORDERS_Copy");
    expect(
      suggestCopiedTableName("ORDERS", ["orders_copy", "ORDERS_Copy2"]),
    ).toBe("ORDERS_Copy3");
  });
});

describe("buildCreateTableSql", () => {
  it("uses the selected PostgreSQL schema and a portable primary-key starter", () => {
    expect(
      buildCreateTableSql("postgresql", {
        profileId: "profile-1",
        schemaName: "sales",
      }),
    ).toBe(
      'CREATE TABLE "sales"."NEW_TABLE" (\n' +
        '  "ID" INTEGER NOT NULL,\n' +
        '  PRIMARY KEY ("ID")\n' +
        ');',
    );
  });

  it("uses a three-part target and SQL Server identifiers when a catalog is selected", () => {
    expect(
      buildCreateTableSql("sqlserver", {
        profileId: "profile-1",
        schemaName: "dbo",
        catalogName: "inventory",
      }),
    ).toContain("CREATE TABLE [inventory].[dbo].[NEW_TABLE]");
  });

  it("uses NUMBER for Oracle's starter primary-key column", () => {
    expect(
      buildCreateTableSql("oracle", {
        profileId: "profile-1",
        schemaName: "APP",
      }),
    ).toContain('"ID" NUMBER NOT NULL');
  });
});

describe("buildCreateTableDraftSql", () => {
  it("keeps CREATE TABLE header, columns, and closing parenthesis in one executable statement", () => {
    const statements = buildCreateTableDraftStatements("sqlserver", {
      profileId: "profile-1",
      catalogName: "sandbox_db",
      schemaName: "dbo",
      tableName: "USERS",
      tableComment: "사용자",
      columns: [
        {
          id: "a",
          name: "USER_ID",
          typeName: "numeric",
          nullable: false,
          primaryKeyOrder: 1,
          comment: "사용자아이디",
        },
      ],
    });

    expect(statements).toHaveLength(3);
    expect(statements[0]).toBe(
      "CREATE TABLE [sandbox_db].[dbo].[USERS] (\n" +
        "  [USER_ID] numeric NOT NULL,\n" +
        "  PRIMARY KEY ([USER_ID])\n" +
        ");",
    );
    expect(statements[1]).toContain("sp_addextendedproperty");
    expect(statements[2]).toContain("@level2name=N'USER_ID'");
  });

  it("uses explicit PK order rather than the column grid order", () => {
    expect(
      buildCreateTableDraftSql("postgresql", {
        profileId: "profile-1",
        schemaName: "sales",
        tableName: "orders",
        columns: [
          { id: "a", name: "store_id", typeName: "INTEGER", nullable: false, primaryKeyOrder: 2 },
          { id: "b", name: "company_id", typeName: "INTEGER", nullable: false, primaryKeyOrder: 1 },
        ],
      }),
    ).toContain('PRIMARY KEY ("company_id", "store_id")');
  });

  it("keeps SQLite comments in the initial CREATE TABLE statement", () => {
    expect(
      buildCreateTableDraftSql("sqlite", {
        profileId: "profile-1",
        schemaName: "main",
        tableName: "sample",
        tableComment: "sample table",
        columns: [{ id: "a", name: "id", typeName: "INTEGER", nullable: false, comment: "identifier" }],
      }),
    ).toContain("/* identifier */");
  });
});
