import { describe, expect, it } from "vitest";
import {
  buildCreateRoutineSql,
  buildCreateRoutineDraftSql,
  buildCreatePackageSql,
  defaultRoutineBody,
  supportsPackageCreation,
  supportsRoutineCreation,
} from "./createRoutineSql";

const target = { profileId: "p1", schemaName: "dbo", catalogName: "Sales" };

describe("buildCreateRoutineSql", () => {
  it("uses a schema-qualified SQL Server name; the selected database is a session target", () => {
    expect(buildCreateRoutineSql("sqlserver", target, "procedure")).toContain(
      "CREATE PROCEDURE [dbo].[NEW_PROCEDURE]",
    );
  });

  it("uses a valid T-SQL procedure body for a new draft", () => {
    expect(defaultRoutineBody("sqlserver", "procedure")).toBe(
      "BEGIN\n  SET NOCOUNT ON;\nEND;",
    );
  });

  it("uses valid initial procedure bodies for MySQL-family dialects", () => {
    expect(defaultRoutineBody("mysql", "procedure")).toContain("SELECT 1;");
    expect(defaultRoutineBody("mariadb", "procedure")).toContain("SELECT 1;");
    expect(defaultRoutineBody("postgresql", "procedure")).toContain("NULL;");
  });

  it("keeps dialect-specific function wrappers when saving a draft", () => {
    const body = "BEGIN\n  RETURN 0;\nEND;";
    expect(buildCreateRoutineDraftSql("postgresql", target, "function", "F1", body)).toContain("$$;");
    expect(buildCreateRoutineDraftSql("mysql", target, "function", "F1", body)).toContain("DETERMINISTIC\nBEGIN");
    expect(buildCreateRoutineDraftSql("mariadb", target, "procedure", "P1", "BEGIN\n  SELECT 1;\nEND;")).toContain("CREATE PROCEDURE");
  });

  it("creates an Oracle function body with a return value", () => {
    const sql = buildCreateRoutineSql("oracle", { ...target, catalogName: undefined }, "function");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION \"dbo\".\"NEW_FUNCTION\"");
    expect(sql).toContain("RETURN NUMBER");
  });

  it("does not offer stored routines for SQLite", () => {
    expect(supportsRoutineCreation("sqlite")).toBe(false);
    expect(supportsRoutineCreation("postgresql")).toBe(true);
  });

  it("creates Oracle package specification and body together", () => {
    const sql = buildCreatePackageSql({ ...target, catalogName: undefined });
    expect(sql).toContain("CREATE OR REPLACE PACKAGE \"dbo\".\"NEW_PACKAGE\" AS");
    expect(sql).toContain("CREATE OR REPLACE PACKAGE BODY \"dbo\".\"NEW_PACKAGE\" AS");
    expect(supportsPackageCreation("oracle")).toBe(true);
    expect(supportsPackageCreation("sqlserver")).toBe(false);
  });
});
