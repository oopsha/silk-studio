import { describe, expect, it } from "vitest";
import { buildInsertStatement, buildUpdateStatement } from "./safeUpdateSql";
import { CURRENT_TIMESTAMP_VALUE } from "./queryResultTemporalValue";

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

  it("updates a primary-key value while locating the row by its original value", () => {
    const sql = buildUpdateStatement({
      schema: "public",
      table: "orders",
      driverId: "postgresql",
      primaryKeys: ["id"],
      originalRow: { id: "1" },
      changes: [{ column: "id", originalValue: "1", currentValue: "2" }],
    });

    expect(sql).toBe(
      'UPDATE "public"."orders" SET "id" = \'2\' WHERE "id" = \'1\'',
    );
  });

  it("uses an explicit Oracle timestamp conversion instead of the session date format", () => {
    const sql = buildUpdateStatement({
      schema: "STUDY",
      table: "HANDOVER",
      driverId: "oracle",
      primaryKeys: ["HANDOVER_ID"],
      originalRow: { HANDOVER_ID: "2" },
      columnTypes: { WORK_DATE: { jdbcType: 93, typeName: "TIMESTAMP" } },
      changes: [{ column: "WORK_DATE", originalValue: "2026-09-16 00:00:00.0", currentValue: "2026-09-17 01:01:01" }],
    });

    expect(sql).toBe(
      'UPDATE "STUDY"."HANDOVER" SET "WORK_DATE" = TO_TIMESTAMP(\'2026-09-17 01:01:01\', \'YYYY-MM-DD HH24:MI:SS\') WHERE "HANDOVER_ID" = \'2\'',
    );
  });

  it("uses explicit temporal conversions for SQL Server and PostgreSQL", () => {
    const common = {
      schema: "public",
      table: "events",
      primaryKeys: ["id"],
      originalRow: { id: "1" },
      columnTypes: { OCCURRED_AT: { jdbcType: 93, typeName: "TIMESTAMP" } },
      changes: [{ column: "OCCURRED_AT", originalValue: "2026-09-16 00:00:00", currentValue: "2026-09-17 01:01:01" }],
    };

    expect(buildUpdateStatement({ ...common, driverId: "sqlserver" })).toContain(
      "CONVERT(datetime2, N'2026-09-17 01:01:01', 120)",
    );
    expect(buildUpdateStatement({ ...common, driverId: "postgresql" })).toContain(
      "'2026-09-17 01:01:01'::timestamp",
    );
  });

  it("uses each database's current-time expression for the Now cell value", () => {
    const input = {
      schema: "STUDY",
      table: "HANDOVER",
      primaryKeys: ["HANDOVER_ID"],
      originalRow: { HANDOVER_ID: "2" },
      columnTypes: { WORK_DATE: { jdbcType: 93, typeName: "TIMESTAMP" } },
      changes: [{ column: "WORK_DATE", originalValue: "2026-09-16 00:00:00", currentValue: CURRENT_TIMESTAMP_VALUE }],
    };

    expect(buildUpdateStatement({ ...input, driverId: "oracle" })).toContain('"WORK_DATE" = SYSTIMESTAMP');
    expect(buildUpdateStatement({ ...input, driverId: "sqlserver" })).toContain("[WORK_DATE] = SYSDATETIME()");
    expect(buildUpdateStatement({ ...input, driverId: "postgresql" })).toContain('"WORK_DATE" = CURRENT_TIMESTAMP');
  });

  it("keeps an explicit empty value out of Oracle's timestamp conversion", () => {
    const sql = buildUpdateStatement({
      schema: "STUDY",
      table: "HANDOVER",
      driverId: "oracle",
      primaryKeys: ["HANDOVER_ID"],
      originalRow: { HANDOVER_ID: "2" },
      columnTypes: { WORK_DATE: { jdbcType: 93, typeName: "TIMESTAMP" } },
      changes: [{ column: "WORK_DATE", originalValue: "2026-09-16 00:00:00", currentValue: "" }],
    });

    expect(sql).toContain('"WORK_DATE" = \'\'');
    expect(sql).not.toContain("TO_TIMESTAMP");
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
