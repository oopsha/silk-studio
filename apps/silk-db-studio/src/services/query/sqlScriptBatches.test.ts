import { describe, expect, it } from "vitest";
import {
  extractExecutableScript,
  findGoSeparatorRanges,
  goBatchesInRange,
} from "./sqlScriptBatches";

describe("findGoSeparatorRanges", () => {
  it("finds standalone GO lines case-insensitively", () => {
    const sql = "SELECT 1;\nGO\nSELECT 2;\ngo\nSELECT 3";
    const seps = findGoSeparatorRanges(sql, 0, sql.length);
    expect(seps).toHaveLength(2);
  });

  it("ignores GO inside strings and comments", () => {
    const sql = "SELECT 'GO';\n-- GO\nSELECT 1;\n/* GO */\nGO\nSELECT 2";
    const seps = findGoSeparatorRanges(sql, 0, sql.length);
    expect(seps).toHaveLength(1);
  });

  it("allows optional repeat count", () => {
    const sql = "SELECT 1;\nGO 2\nSELECT 2";
    const seps = findGoSeparatorRanges(sql, 0, sql.length);
    expect(seps).toHaveLength(1);
  });

  it("does not treat GO as separator mid-line", () => {
    const sql = "EXEC GO;\nSELECT 1";
    const seps = findGoSeparatorRanges(sql, 0, sql.length);
    expect(seps).toHaveLength(0);
  });
});

describe("goBatchesInRange", () => {
  it("splits IF/ELSE batches without breaking on internal semicolons", () => {
    const sql = [
      "SET NOCOUNT ON;",
      "GO",
      "IF EXISTS (SELECT 1)",
      "    EXEC sys.sp_updateextendedproperty @name = N'MS_Description', @value = N'a';",
      "ELSE",
      "    EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'a';",
      "GO",
      "SELECT 1;",
    ].join("\n");

    const batches = goBatchesInRange(sql, 0, sql.length);
    expect(batches).toHaveLength(3);
    expect(batches[0].sql).toBe("SET NOCOUNT ON");
    expect(batches[1].sql).toContain("IF EXISTS");
    expect(batches[1].sql).toContain("ELSE");
    expect(batches[1].sql).not.toMatch(/\bGO\b/i);
    expect(batches[2].sql).toBe("SELECT 1");
  });

  it("returns one batch when there is no GO", () => {
    const sql = "SELECT 1;\nSELECT 2;";
    const batches = goBatchesInRange(sql, 0, sql.length);
    expect(batches).toHaveLength(1);
    expect(batches[0].sql).toContain("SELECT 1");
    expect(batches[0].sql).toContain("SELECT 2");
  });
});

describe("extractExecutableScript", () => {
  it("uses GO batches for sqlserver", () => {
    const sql = "SELECT 1\nGO\nSELECT 2";
    const { statements, usedGo } = extractExecutableScript(sql, 0, 0, "sqlserver");
    expect(usedGo).toBe(true);
    expect(statements).toHaveLength(2);
  });

  it("uses semicolon split for other drivers", () => {
    const sql = "SELECT 1;\nGO;\nSELECT 2;";
    const { statements, usedGo } = extractExecutableScript(
      sql,
      0,
      0,
      "postgresql",
    );
    expect(usedGo).toBe(false);
    expect(statements).toHaveLength(3);
    expect(statements[1].sql.toUpperCase()).toBe("GO");
  });

  it("prefers selection over whole buffer", () => {
    const sql = "SELECT 1\nGO\nSELECT 2\nGO\nSELECT 3";
    const selStart = sql.indexOf("SELECT 2");
    const selEnd = sql.indexOf("\nGO\nSELECT 3");
    const { statements, mode } = extractExecutableScript(
      sql,
      selStart,
      selEnd,
      "sqlserver",
    );
    expect(mode).toBe("selection");
    expect(statements).toHaveLength(1);
    expect(statements[0].sql).toBe("SELECT 2");
  });
});
