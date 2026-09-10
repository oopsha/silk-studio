import { describe, expect, it } from "vitest";
import {
  buildCreateRoutineSql,
  buildCreatePackageSql,
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
