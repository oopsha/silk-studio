import { describe, expect, it } from "vitest";
import { detectSqlClause } from "./sqlCompletionClause";
import { wantsBucket } from "./sqlCompletionPolicy";
import { parseSqlRelations } from "./sqlCompletionRelations";
import { parseSqlQueryScope } from "./sqlCompletionScope";
import { functionsForDriver } from "./sqlFunctions";
import {
  CLAUSE_FIXTURES,
  RELATION_FIXTURES,
  SCOPE_FIXTURES,
} from "./sqlIntellisense.fixtures";

describe("I-A fixtures: clause detection", () => {
  for (const fixture of CLAUSE_FIXTURES) {
    it(fixture.id, () => {
      expect(detectSqlClause(fixture.sql)).toBe(fixture.expectClause);
    });
  }

  it("empty editor policy excludes functions", () => {
    expect(wantsBucket("statement_start", "functions")).toBe(false);
    expect(wantsBucket("statement_start", "statement_start_keywords")).toBe(
      true,
    );
    const abs = functionsForDriver("oracle").map((n) => n.toUpperCase());
    expect(abs).toContain("ABS");
  });
});

describe("I-B fixtures: FROM/JOIN relations", () => {
  for (const fixture of RELATION_FIXTURES) {
    it(fixture.id, () => {
      const relations = parseSqlRelations(fixture.sql);
      expect(relations).toEqual(fixture.expectRelations);
    });
  }
});

describe("I-C fixtures: CTE and subquery scope", () => {
  for (const fixture of SCOPE_FIXTURES) {
    it(fixture.id, () => {
      let cursor =
        fixture.cursorAt ??
        (fixture.id === "cte-body-prior-only"
          ? fixture.sql.indexOf("a.x") + 2
          : fixture.sql.length);

      const { relations, visibleCtes } = parseSqlQueryScope(
        fixture.sql,
        cursor,
      );

      expect(relations.map((r) => r.alias)).toEqual(fixture.expectAliases);

      if (fixture.expectCteNames) {
        expect(visibleCtes.map((c) => c.name)).toEqual(fixture.expectCteNames);
      }

      if (fixture.expectColumnsByAlias) {
        for (const [alias, columns] of Object.entries(
          fixture.expectColumnsByAlias,
        )) {
          const rel = relations.find((r) => r.alias === alias);
          expect(rel?.columns).toEqual(columns);
        }
      }

      if (fixture.id === "subquery-inner-only") {
        expect(relations.some((r) => r.table === "emp")).toBe(false);
      }
    });
  }
});
