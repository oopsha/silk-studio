import { describe, expect, it } from "vitest";
import { buildCreateIndexSql, buildCreateTriggerSql } from "./createTableChildSql";

const target = { schemaName: "dbo", tableName: "ORDERS", catalogName: "Sales" };

describe("table child creation SQL", () => {
  it("targets the selected SQL Server table when creating an index", () => {
    expect(buildCreateIndexSql("sqlserver", target, "ORDER_ID")).toBe(
      "CREATE INDEX [ORDERS_IDX]\nON [Sales].[dbo].[ORDERS] ([ORDER_ID]);",
    );
  });

  it("creates a SQL Server trigger scaffold bound to the selected table", () => {
    expect(buildCreateTriggerSql("sqlserver", target)).toContain(
      "ON [Sales].[dbo].[ORDERS]",
    );
  });

  it("creates a PostgreSQL trigger function and trigger scaffold", () => {
    expect(buildCreateTriggerSql("postgresql", target)).toContain(
      'RETURNS trigger',
    );
  });
});
