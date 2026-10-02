import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseDelimitedFile, parseExcelWorkbook } from "./queryResultImport";

describe("parseDelimitedFile", () => {
  it("parses quoted CSV fields, escaped quotes, and embedded newlines", () => {
    expect(parseDelimitedFile('\uFEFFid,name,note\r\n1,"Doe, Jane","line 1\nline 2"\r\n2,"A ""quote""",')).toEqual({
      delimiter: ",",
      rows: [
        ["id", "name", "note"],
        ["1", "Doe, Jane", "line 1\nline 2"],
        ["2", 'A "quote"', ""],
      ],
    });
  });

  it("detects tab and semicolon delimiters and pads short rows", () => {
    expect(parseDelimitedFile("id\tname\n1\tAda\n2")).toEqual({
      delimiter: "\t",
      rows: [["id", "name"], ["1", "Ada"], ["2", ""]],
    });
    expect(parseDelimitedFile("id;name\n1;Ada").delimiter).toBe(";");
  });
});

describe("parseExcelWorkbook", () => {
  it.each(["xlsx", "biff8"] as const)("reads %s files with multiple sheets and database-ready values", async (bookType) => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([]), "빈 시트");
    const sheet = XLSX.utils.aoa_to_sheet([
      ["id", "name", "amount", "created_at", "time", "note", "enabled", "formula"],
      ["00123", "홍길동", 1234.5, new Date(2026, 8, 30, 14, 5, 6), (14 * 3600 + 5 * 60 + 6) / 86400, "첫 줄\n둘째 줄", true, 5],
      ["00002", "김철수", 0, new Date(2026, 9, 1), null, "", false],
    ]);
    sheet.C2.z = "#,##0.00";
    sheet.D2.z = "m/d/yy h:mm";
    sheet.D3.z = "m/d/yy";
    sheet.E2.z = "hh:mm:ss";
    sheet.H2.f = "2+3";
    XLSX.utils.book_append_sheet(workbook, sheet, "고객");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["name", "id"], ["다른 시트", "9"]]), "추가");

    const parsed = await parseExcelWorkbook(XLSX.write(workbook, { type: "array", bookType }) as ArrayBuffer);
    expect(parsed).toEqual({
      kind: "workbook",
      sheets: [
        { name: "빈 시트", rows: [] },
        { name: "고객", rows: [
          ["id", "name", "amount", "created_at", "time", "note", "enabled", "formula"],
          ["00123", "홍길동", "1234.50", "2026-09-30 14:05:06", "14:05:06", "첫 줄\n둘째 줄", "true", "5"],
          ["00002", "김철수", "0", "2026-10-01", "", "", "false", ""],
        ] },
        { name: "추가", rows: [["name", "id"], ["다른 시트", "9"]] },
      ],
    });
  });

  it("honors the 1904 date system and fractional seconds", async () => {
    const workbook = XLSX.utils.book_new();
    workbook.Workbook = { WBProps: { date1904: true } };
    const sheet = XLSX.utils.aoa_to_sheet([["date", "time"], [1, (14 * 3600 + 5 * 60 + 6.125) / 86400]]);
    sheet.A2.z = "m/d/yy";
    sheet.B2.z = "hh:mm:ss.000";
    XLSX.utils.book_append_sheet(workbook, sheet, "Dates");
    const parsed = await parseExcelWorkbook(XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
    expect(parsed.kind).toBe("workbook");
    if (parsed.kind === "workbook") expect(parsed.sheets[0].rows[1]).toEqual(["1904-01-02", "14:05:06.125"]);
  });
});
