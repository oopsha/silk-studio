import { describe, expect, it } from "vitest";
import {
  detectSqlClause,
  extractStatementPrefix,
  stripSqlComments,
} from "./sqlCompletionClause";
import { wantsBucket } from "./sqlCompletionPolicy";
import {
  functionsForDriver,
  statementStartKeywordsForDriver,
} from "./sqlKeywords";

describe("extractStatementPrefix", () => {
  it("returns text after the last semicolon", () => {
    expect(extractStatementPrefix("SELECT 1; SELECT ")).toBe(" SELECT ");
  });

  it("ignores semicolons inside single quotes", () => {
    expect(extractStatementPrefix("SELECT ';'; SELECT ")).toBe(" SELECT ");
  });
});

describe("stripSqlComments", () => {
  it("removes line and block comments", () => {
    expect(stripSqlComments("SELECT -- hi\n1 /* x */ FROM")).toMatch(
      /SELECT\s+1\s+FROM/,
    );
  });
});

describe("detectSqlClause", () => {
  it("returns statement_start for empty / whitespace", () => {
    expect(detectSqlClause("")).toBe("statement_start");
    expect(detectSqlClause("   \n\t")).toBe("statement_start");
  });

  it("returns statement_start while typing the first keyword", () => {
    expect(detectSqlClause("SEL")).toBe("statement_start");
    expect(detectSqlClause("WITH")).toBe("statement_start");
  });

  it("detects select_list after SELECT", () => {
    expect(detectSqlClause("SELECT ")).toBe("select_list");
    expect(detectSqlClause("SELECT a, ")).toBe("select_list");
  });

  it("detects from / join / where", () => {
    expect(detectSqlClause("SELECT * FROM ")).toBe("from");
    expect(detectSqlClause("SELECT * FROM t JOIN ")).toBe("join");
    expect(detectSqlClause("SELECT * FROM t WHERE ")).toBe("where");
    expect(detectSqlClause("SELECT * FROM t LEFT OUTER JOIN ")).toBe("join");
  });

  it("detects order_by and group_by", () => {
    expect(detectSqlClause("SELECT a FROM t GROUP BY ")).toBe("group_by");
    expect(detectSqlClause("SELECT a FROM t ORDER BY ")).toBe("order_by");
  });

  it("detects insert / values / update / set", () => {
    expect(detectSqlClause("INSERT INTO ")).toBe("insert");
    expect(detectSqlClause("INSERT INTO t VALUES ")).toBe("values");
    expect(detectSqlClause("UPDATE ")).toBe("update");
    expect(detectSqlClause("UPDATE t SET ")).toBe("set");
  });

  it("uses the last clause in the statement", () => {
    expect(
      detectSqlClause("SELECT a FROM emp WHERE id = 1 AND "),
    ).toBe("where");
  });

  it("ignores clause keywords inside string literals", () => {
    expect(detectSqlClause("SELECT 'FROM' ")).toBe("select_list");
  });
});

describe("completion policy + keywords split", () => {
  it("does not offer functions at statement_start", () => {
    expect(wantsBucket("statement_start", "functions")).toBe(false);
    expect(wantsBucket("statement_start", "statement_start_keywords")).toBe(
      true,
    );
  });

  it("offers functions and columns in select_list", () => {
    expect(wantsBucket("select_list", "functions")).toBe(true);
    expect(wantsBucket("select_list", "columns")).toBe(true);
    expect(wantsBucket("select_list", "routines")).toBe(true);
    expect(wantsBucket("select_list", "tables")).toBe(false);
  });

  it("offers routines in where, not tables", () => {
    expect(wantsBucket("where", "routines")).toBe(true);
    expect(wantsBucket("where", "functions")).toBe(true);
    expect(wantsBucket("where", "tables")).toBe(false);
  });

  it("offers tables in from, not functions", () => {
    expect(wantsBucket("from", "tables")).toBe(true);
    expect(wantsBucket("from", "schemas")).toBe(true);
    expect(wantsBucket("from", "functions")).toBe(false);
    expect(wantsBucket("from", "routines")).toBe(false);
    expect(wantsBucket("from", "columns")).toBe(false);
  });

  it("keeps ABS/COUNT out of statement-start keyword list", () => {
    const starts = statementStartKeywordsForDriver("oracle").map((w) =>
      w.toUpperCase(),
    );
    const fns = functionsForDriver("oracle").map((w) => w.toUpperCase());
    expect(starts).toContain("SELECT");
    expect(starts).not.toContain("ABS");
    expect(starts).not.toContain("COUNT");
    expect(fns).toContain("ABS");
    expect(fns).toContain("COUNT");
  });
});
