import { describe, expect, it } from "vitest";
import { inferSelectListColumns } from "./sqlCompletionSelectList";
import {
  findInnermostSelectScope,
  parseSqlCtes,
  parseSqlQueryScope,
} from "./sqlCompletionScope";

describe("inferSelectListColumns", () => {
  it("reads simple columns and aliases", () => {
    expect(
      inferSelectListColumns("SELECT id, name AS n, COUNT(*) cnt FROM t"),
    ).toEqual(["id", "n", "cnt"]);
  });

  it("skips stars", () => {
    expect(inferSelectListColumns("SELECT * FROM t")).toEqual([]);
    expect(inferSelectListColumns("SELECT t.* FROM t")).toEqual([]);
  });
});

describe("parseSqlCtes", () => {
  it("parses CTE name and inferred columns", () => {
    const ctes = parseSqlCtes(
      "WITH c AS (SELECT id, name FROM t) SELECT * FROM c",
    );
    expect(ctes).toHaveLength(1);
    expect(ctes[0]?.name).toBe("c");
    expect(ctes[0]?.columns).toEqual(["id", "name"]);
  });

  it("prefers explicit column lists", () => {
    const ctes = parseSqlCtes(
      "WITH c (x, y) AS (SELECT 1, 2 FROM dual) SELECT * FROM c",
    );
    expect(ctes[0]?.columns).toEqual(["x", "y"]);
  });

  it("parses multiple CTEs", () => {
    const ctes = parseSqlCtes(
      "WITH a AS (SELECT id FROM t), b AS (SELECT a.id FROM a) SELECT * FROM b",
    );
    expect(ctes.map((c) => c.name)).toEqual(["a", "b"]);
  });
});

describe("findInnermostSelectScope", () => {
  it("narrows to the nested subquery", () => {
    const sql =
      "SELECT * FROM emp e WHERE e.id IN (SELECT d.id FROM dept d WHERE d.";
    const cursor = sql.length;
    const scope = findInnermostSelectScope(sql, cursor);
    const slice = sql.slice(scope.start, scope.end);
    expect(slice).toMatch(/SELECT d\.id FROM dept d/i);
    expect(slice).not.toMatch(/\bemp\b/i);
  });
});

describe("parseSqlQueryScope", () => {
  it("exposes CTE columns on FROM c / c.", () => {
    const sql = "WITH c AS (SELECT id FROM t) SELECT * FROM c WHERE c.";
    const { relations, visibleCtes } = parseSqlQueryScope(sql, sql.length);
    expect(visibleCtes.map((c) => c.name)).toEqual(["c"]);
    expect(relations).toEqual([
      { table: "c", alias: "c", columns: ["id"] },
    ]);
  });

  it("uses only inner FROM inside a subquery", () => {
    const sql =
      "SELECT * FROM emp e WHERE e.id IN (SELECT x FROM dept d WHERE d.";
    const { relations } = parseSqlQueryScope(sql, sql.length);
    expect(relations.map((r) => r.alias)).toEqual(["d"]);
    expect(relations.some((r) => r.table === "emp")).toBe(false);
  });

  it("inside CTE body only sees prior CTEs and inner FROM", () => {
    const full =
      "WITH a AS (SELECT id FROM t), b AS (SELECT a.id FROM a WHERE a.x = 1) SELECT * FROM b";
    const cursor = full.indexOf("a.x") + 2; // after "a."
    const { relations, visibleCtes } = parseSqlQueryScope(full, cursor);
    expect(visibleCtes.map((c) => c.name)).toEqual(["a"]);
    expect(relations.map((r) => r.alias)).toEqual(["a"]);
    expect(relations[0]?.columns).toEqual(["id"]);
  });

  it("parses derived table columns", () => {
    const sql =
      "SELECT * FROM (SELECT id, name FROM emp) t WHERE t.";
    const { relations } = parseSqlQueryScope(sql, sql.length);
    expect(relations).toEqual([
      { table: "t", alias: "t", columns: ["id", "name"] },
    ]);
  });
});
