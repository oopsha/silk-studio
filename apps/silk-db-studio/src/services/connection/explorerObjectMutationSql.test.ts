import { describe, expect, it } from "vitest";
import {
  buildRenameObjectSql,
  supportsRenameObject,
} from "./explorerObjectMutationSql";

describe("SQL Server object rename", () => {
  it("enables table rename only", () => {
    expect(supportsRenameObject("table", "sqlserver")).toBe(true);
    expect(supportsRenameObject("view", "sqlserver")).toBe(false);
    expect(supportsRenameObject("procedure", "sqlserver")).toBe(false);
  });

  it("builds the current-database sp_rename statement", () => {
    expect(
      buildRenameObjectSql(
        {
          driverId: "sqlserver",
          kind: "table",
          schemaName: "dbo",
          objectName: "TEST_TABLE",
        },
        "RENAMED_TABLE",
      ),
    ).toBe(
      "EXEC sys.sp_rename @objname = N'[dbo].[TEST_TABLE]', @newname = N'RENAMED_TABLE', @objtype = N'OBJECT'",
    );
  });
});
