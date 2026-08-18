import { describe, expect, it } from "vitest";
import { resolveIdentifierAtPosition } from "./sqlIdentifierAtPosition";

/** Minimal single-line stand-in for Monaco's editor.ITextModel, word-boundary compatible. */
function fakeModel(line: string) {
  const wordPattern = /[A-Za-z0-9_$#]+/g;

  return {
    getWordAtPosition({ column }: { column: number }) {
      wordPattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = wordPattern.exec(line))) {
        const startColumn = match.index + 1;
        const endColumn = match.index + match[0].length + 1;
        if (column >= startColumn && column <= endColumn) {
          return { word: match[0], startColumn, endColumn };
        }
      }
      return null;
    },
    getValueInRange({
      startColumn,
      endColumn,
    }: {
      startColumn: number;
      endColumn: number;
    }) {
      return line.slice(startColumn - 1, endColumn - 1);
    },
    // biome-ignore lint: satisfies editor.ITextModel's shape loosely enough for this helper's needs
  } as any;
}

describe("resolveIdentifierAtPosition", () => {
  const sql = "SELECT * FROM PSM.dbo.PST_DISTRIBUTE_MNG_50 A";
  // Columns (1-based): "PSM" = 16-18, "dbo" = 20-22, "PST_DISTRIBUTE_MNG_50" = 24-44
  const model = fakeModel(sql);

  it("resolves the full chain when the cursor is on the trailing table segment", () => {
    const result = resolveIdentifierAtPosition(model, {
      lineNumber: 1,
      column: 30,
    });
    expect(result).toEqual({
      database: "PSM",
      qualifier: "dbo",
      name: "PST_DISTRIBUTE_MNG_50",
    });
  });

  it("resolves the same chain when the cursor is on the middle schema segment", () => {
    const result = resolveIdentifierAtPosition(model, {
      lineNumber: 1,
      column: 21,
    });
    expect(result).toEqual({
      database: "PSM",
      qualifier: "dbo",
      name: "PST_DISTRIBUTE_MNG_50",
    });
  });

  it("resolves the same chain when the cursor is on the leading database segment", () => {
    const result = resolveIdentifierAtPosition(model, {
      lineNumber: 1,
      column: 17,
    });
    expect(result).toEqual({
      database: "PSM",
      qualifier: "dbo",
      name: "PST_DISTRIBUTE_MNG_50",
    });
  });

  it("resolves a plain two-part schema.table identifier", () => {
    const twoPart = fakeModel("SELECT * FROM dbo.TRAN_LOG");
    const result = resolveIdentifierAtPosition(twoPart, {
      lineNumber: 1,
      column: 16,
    });
    expect(result).toEqual({ database: null, qualifier: "dbo", name: "TRAN_LOG" });
  });

  it("resolves a bare unqualified identifier", () => {
    const bare = fakeModel("SELECT * FROM TRAN_LOG");
    const result = resolveIdentifierAtPosition(bare, {
      lineNumber: 1,
      column: 16,
    });
    expect(result).toEqual({ database: null, qualifier: null, name: "TRAN_LOG" });
  });
});
