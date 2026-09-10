import { describe, expect, it } from "vitest";
import { withDdlSchemaQualification } from "./ddlSchemaQualification";

describe("withDdlSchemaQualification", () => {
  it("removes the current SQL Server schema qualifier but preserves another schema", () => {
    expect(
      withDdlSchemaQualification(
        "CREATE TABLE [dbo].[ORDERS] ([ID] int, [audit].[LOG_ID] int);",
        "dbo",
        "sqlserver",
        false,
      ),
    ).toBe("CREATE TABLE [ORDERS] ([ID] int, [audit].[LOG_ID] int);");
  });

  it("removes Oracle-style quoted schema qualifiers", () => {
    expect(
      withDdlSchemaQualification(
        'CREATE TABLE "ADMIN"."HANDOVER" ("ID" NUMBER);',
        "ADMIN",
        "oracle",
        false,
      ),
    ).toBe('CREATE TABLE "HANDOVER" ("ID" NUMBER);');
  });

  it("leaves DDL unchanged while schema inclusion is enabled", () => {
    const ddl = "CREATE TABLE [dbo].[ORDERS] ([ID] int);";
    expect(withDdlSchemaQualification(ddl, "dbo", "sqlserver", true)).toBe(ddl);
  });
});
