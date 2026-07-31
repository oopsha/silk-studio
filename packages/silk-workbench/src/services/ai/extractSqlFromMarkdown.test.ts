import { describe, expect, it } from "vitest";
import { extractSqlFromMarkdown } from "./extractSqlFromMarkdown";

describe("extractSqlFromMarkdown", () => {
  it("prefers sql-tagged fences", () => {
    const md = [
      "Here you go:",
      "```sql",
      "SELECT 1;",
      "```",
      "```",
      "SELECT 2;",
      "```",
    ].join("\n");
    expect(extractSqlFromMarkdown(md)).toEqual(["SELECT 1;"]);
  });

  it("falls back to unlabeled SQL-looking fences", () => {
    const md = ["```", "SELECT * FROM dual", "```"].join("\n");
    expect(extractSqlFromMarkdown(md)).toEqual(["SELECT * FROM dual"]);
  });

  it("returns empty for prose without fences", () => {
    expect(extractSqlFromMarkdown("Just run a select query.")).toEqual([]);
  });
});
