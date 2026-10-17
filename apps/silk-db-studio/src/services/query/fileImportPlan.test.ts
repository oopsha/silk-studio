import { describe, expect, it } from "vitest";
import { importCell, validateImport, type FileImportPlan } from "./fileImportPlan";
import { parseDelimitedFile } from "./queryResultImport";
import { toCsv } from "./queryResultFormat";

describe("file import empty cell policies", () => {
  it("round trips empty CSV fields as SQL NULL while preserving decimals and literal NULL text", () => {
    const csv = toCsv(["amount", "note", "text"], [["1234.560", null, "NULL"]]);
    expect(csv).toContain("1234.560,,NULL");
    const row = parseDelimitedFile(csv).rows[1];
    expect(row.map((value) => importCell(value, { kind: "null" }))).toEqual(["1234.560", null, "NULL"]);
  });
  it("distinguishes null, empty string, fixed value and whitespace", () => {
    expect(importCell("", { kind: "null" })).toBeNull();
    expect(importCell("", { kind: "empty" })).toBe("");
    expect(importCell("", { kind: "value", value: "0" })).toBe("0");
    expect(importCell("  ", { kind: "null" })).toBe("  ");
  });
  it("does not lose records whose every field is NULL", () => {
    const parsed = parseDelimitedFile(toCsv(["a", "b", "c"], [[null, null, null], ["1", null, null]]));
    expect(parsed.rows).toEqual([["a", "b", "c"], ["", "", ""], ["1", "", ""]]);
    expect(parseDelimitedFile('a\n\n""\n').rows).toEqual([["a"], [""]]);
  });
  it("reports counts and original record numbers before executing", () => {
    const plan: FileImportPlan = { columns: [{ name: "AMOUNT", sourceIndex: 1, empty: { kind: "null" } }],
      rows: [["x", ""], ["x", "123.456"], ["x", ""]], firstFileRow: 4, clearExisting: true };
    expect(validateImport(plan, [{ name: "AMOUNT", typeName: "DECIMAL", nullable: false }], false)).toEqual([
      { column: "AMOUNT", count: 2, firstFileRow: 4, reason: "notNull" },
    ]);
    plan.columns[0].empty = { kind: "value", value: "0" };
    expect(validateImport(plan, [{ name: "AMOUNT", typeName: "DECIMAL", nullable: false }], false)).toEqual([]);
  });
  it("rejects blank numeric strings and accounts for Oracle empty-string NULL semantics", () => {
    const plan: FileImportPlan = { columns: [{ name: "C", sourceIndex: 0, empty: { kind: "empty" } }], rows: [[""]], firstFileRow: 2, clearExisting: false };
    expect(validateImport(plan, [{ name: "C", typeName: "INTEGER", nullable: false }], false)[0]?.reason).toBe("number");
    expect(validateImport(plan, [{ name: "C", typeName: "VARCHAR2", nullable: false }], true)[0]?.reason).toBe("notNull");
    expect(validateImport(plan, [{ name: "C", typeName: "VARCHAR", nullable: false }], false)).toEqual([]);
  });
  it("validates only mapped columns, so skipped columns can use database defaults", () => {
    const plan: FileImportPlan = { columns: [{ name: "name", sourceIndex: 0, empty: { kind: "null" } }], rows: [["abcd"]], firstFileRow: 2, clearExisting: false };
    expect(validateImport(plan, [{ name: "name", typeName: "VARCHAR", columnSize: 3 }, { name: "id", nullable: false }], false)).toEqual([
      { column: "name", count: 1, firstFileRow: 2, reason: "length" },
    ]);
  });
});
