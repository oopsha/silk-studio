import { describe, expect, it } from "vitest";
import { buildInsertStatement, buildUpdateStatement } from "./safeUpdateSql";

describe("buildUpdateStatement", () => {
  it("prefixes string literals with N for SQL Server (Unicode literal)", () => {
    const sql = buildUpdateStatement({
      schema: "dbo",
      table: "PST_PAYMENT_50",
      driverId: "sqlserver",
      primaryKeys: ["TRAN_DT"],
      originalRow: { TRAN_DT: "20251107" },
      changes: [
        {
          column: "INPUT_DATA_99",
          originalValue: "old",
          currentValue: "마리오상품권 1만원권 - Test",
        },
      ],
    });

    expect(sql).toBe(
      "UPDATE [dbo].[PST_PAYMENT_50] SET [INPUT_DATA_99] = N'마리오상품권 1만원권 - Test' WHERE [TRAN_DT] = N'20251107'",
    );
  });

  it("does not add an N prefix for non-SQL Server drivers", () => {
    const sql = buildUpdateStatement({
      schema: "public",
      table: "orders",
      driverId: "postgresql",
      primaryKeys: ["id"],
      originalRow: { id: "1" },
      changes: [{ column: "note", originalValue: "old", currentValue: "한글" }],
    });

    expect(sql).toBe(
      'UPDATE "public"."orders" SET "note" = \'한글\' WHERE "id" = \'1\'',
    );
  });
});

describe("buildInsertStatement", () => {
  it("emits every column, using NULL for untouched ones", () => {
    const sql = buildInsertStatement({
      schema: "public",
      table: "orders",
      driverId: "postgresql",
      columns: ["id", "note", "amount"],
      row: { id: "5", note: null, amount: "10.5" },
    });

    expect(sql).toBe(
      'INSERT INTO "public"."orders" ("id", "note", "amount") VALUES (\'5\', NULL, \'10.5\')',
    );
  });

  it("prefixes string literals with N for SQL Server (Unicode literal)", () => {
    const sql = buildInsertStatement({
      schema: "dbo",
      table: "PST_PAYMENT_50",
      driverId: "sqlserver",
      columns: ["TRAN_DT", "INPUT_DATA_99"],
      row: { TRAN_DT: "20251107", INPUT_DATA_99: "마리오상품권 1만원권" },
    });

    expect(sql).toBe(
      "INSERT INTO [dbo].[PST_PAYMENT_50] ([TRAN_DT], [INPUT_DATA_99]) VALUES (N'20251107', N'마리오상품권 1만원권')",
    );
  });
});
