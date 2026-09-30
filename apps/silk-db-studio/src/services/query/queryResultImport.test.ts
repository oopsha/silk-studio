import { describe, expect, it } from "vitest";
import { parseDelimitedFile } from "./queryResultImport";

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
