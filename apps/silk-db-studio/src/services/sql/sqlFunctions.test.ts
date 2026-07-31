import { describe, expect, it } from "vitest";
import {
  findSqlFunction,
  functionsForDriver,
  parseFunctionCallAtCursor,
  sqlFunctionsForDriver,
} from "./sqlFunctions";

describe("sqlFunctionsForDriver", () => {
  it("includes common and dialect functions", () => {
    const oracle = functionsForDriver("oracle").map((n) => n.toUpperCase());
    expect(oracle).toContain("ABS");
    expect(oracle).toContain("NVL");
    expect(oracle).toContain("TO_DATE");
    expect(oracle).not.toContain("GETDATE");

    const tsql = functionsForDriver("sqlserver").map((n) => n.toUpperCase());
    expect(tsql).toContain("ISNULL");
    expect(tsql).toContain("GETDATE");
    expect(tsql).toContain("DATEADD");

    const mysql = functionsForDriver("mysql").map((n) => n.toUpperCase());
    expect(mysql).toContain("IFNULL");
    expect(mysql).toContain("DATE_FORMAT");

    const pg = functionsForDriver("postgresql").map((n) => n.toLowerCase());
    expect(pg).toContain("date_trunc");
    expect(pg).toContain("generate_series");
  });

  it("uses snippet placeholders for representative functions", () => {
    const nvl = findSqlFunction("oracle", "NVL");
    expect(nvl?.insertText).toContain("${1:");
    expect(nvl?.signatures?.[0]?.parameters).toHaveLength(2);

    const abs = findSqlFunction("mysql", "ABS");
    expect(abs?.insertText).toBe("ABS(${1:numeric})");
  });

  it("keeps no-paren literals without snippet tabs", () => {
    const sysdate = findSqlFunction("oracle", "SYSDATE");
    expect(sysdate?.insertText).toBe("SYSDATE");
    expect(sysdate?.signatures).toBeUndefined();
  });

  it("returns a stable catalog size per driver", () => {
    expect(sqlFunctionsForDriver("oracle").length).toBeGreaterThan(20);
    expect(sqlFunctionsForDriver("sqlserver").length).toBeGreaterThan(20);
  });
});

describe("parseFunctionCallAtCursor", () => {
  it("detects function name and active parameter", () => {
    expect(parseFunctionCallAtCursor("SELECT NVL(")).toEqual({
      name: "NVL",
      activeParameter: 0,
    });
    expect(parseFunctionCallAtCursor("SELECT NVL(a, ")).toEqual({
      name: "NVL",
      activeParameter: 1,
    });
  });

  it("handles nested calls", () => {
    expect(parseFunctionCallAtCursor("SELECT COALESCE(ABS(1), ")).toEqual({
      name: "COALESCE",
      activeParameter: 1,
    });
  });
});
