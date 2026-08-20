import { describe, expect, it } from "vitest";
import {
  extractExecutableSql,
  extractExecutableStatements,
  findStatementRange,
  splitSqlStatements,
  statementsInRange,
  stripTrailingSemicolon,
  trimSqlRange,
} from "./sqlExecutable";

describe("splitSqlStatements", () => {
  it("splits plain statements on ;", () => {
    const sql = "SELECT 1; SELECT 2;";
    const ranges = splitSqlStatements(sql);
    expect(ranges.map((r) => sql.slice(r.start, r.end))).toEqual([
      "SELECT 1",
      " SELECT 2",
    ]);
  });

  it("ignores ; inside single-quoted strings", () => {
    const sql = "SELECT 'a;b' FROM t; SELECT 2;";
    const ranges = splitSqlStatements(sql);
    expect(ranges.map((r) => sql.slice(r.start, r.end))).toEqual([
      "SELECT 'a;b' FROM t",
      " SELECT 2",
    ]);
  });

  it("ignores ; inside line and block comments", () => {
    const sql = "SELECT 1; -- a;b\nSELECT 2; /* c;d */ SELECT 3;";
    const ranges = splitSqlStatements(sql);
    expect(ranges).toHaveLength(3);
    expect(sql.slice(ranges[2].start, ranges[2].end)).toBe(
      " /* c;d */ SELECT 3",
    );
  });

  it("treats an anonymous DECLARE/BEGIN block as a single statement", () => {
    const sql = `DECLARE
  x NUMBER := 1;
BEGIN
  NULL;
END;
SELECT 1 FROM dual;`;
    const ranges = splitSqlStatements(sql);
    expect(ranges).toHaveLength(2);
    expect(sql.slice(ranges[0].start, ranges[0].end).trim()).toBe(
      "DECLARE\n  x NUMBER := 1;\nBEGIN\n  NULL;\nEND",
    );
    expect(sql.slice(ranges[1].start, ranges[1].end).trim()).toBe(
      "SELECT 1 FROM dual",
    );
  });

  it("handles nested IF/LOOP/CASE inside a BEGIN block", () => {
    const sql = `BEGIN
  IF 1 = 1 THEN
    NULL;
  END IF;
  FOR i IN 1..3 LOOP
    NULL;
  END LOOP;
END;`;
    const ranges = splitSqlStatements(sql);
    expect(ranges).toHaveLength(1);
    expect(sql.slice(ranges[0].start, ranges[0].end)).toBe(sql.slice(0, -1));
  });

  it("treats CREATE OR REPLACE PROCEDURE ... BEGIN ... END; as a single statement", () => {
    const sql = `CREATE OR REPLACE PROCEDURE foo AS
BEGIN
  NULL;
  IF 1 = 1 THEN
    NULL;
  END IF;
END;
SELECT 1 FROM dual;`;
    const ranges = splitSqlStatements(sql);
    expect(ranges).toHaveLength(2);
    expect(sql.slice(ranges[0].start, ranges[0].end).trim()).toBe(
      `CREATE OR REPLACE PROCEDURE foo AS
BEGIN
  NULL;
  IF 1 = 1 THEN
    NULL;
  END IF;
END`,
    );
    expect(sql.slice(ranges[1].start, ranges[1].end).trim()).toBe(
      "SELECT 1 FROM dual",
    );
  });

  it("treats CREATE FUNCTION ... BEGIN ... END; as a single statement", () => {
    const sql = `CREATE FUNCTION bar RETURN NUMBER IS
BEGIN
  RETURN 1;
END;`;
    const ranges = splitSqlStatements(sql);
    expect(ranges).toHaveLength(1);
  });

  it("treats CREATE OR REPLACE TRIGGER ... BEGIN ... END; as a single statement", () => {
    const sql = `CREATE OR REPLACE TRIGGER trg_foo
BEFORE INSERT ON foo
FOR EACH ROW
BEGIN
  :NEW.id := 1;
END;`;
    const ranges = splitSqlStatements(sql);
    expect(ranges).toHaveLength(1);
  });

  it("does not treat a plain CREATE TABLE as a PL/SQL block", () => {
    const sql = "CREATE TABLE t (id NUMBER); SELECT 1 FROM dual;";
    const ranges = splitSqlStatements(sql);
    expect(ranges).toHaveLength(2);
  });
});

describe("stripTrailingSemicolon", () => {
  it("strips the trailing ; for plain SQL", () => {
    expect(stripTrailingSemicolon("SELECT 1 FROM dual;")).toBe(
      "SELECT 1 FROM dual",
    );
  });

  it("keeps the trailing ; for an anonymous PL/SQL block", () => {
    const sql = "BEGIN\n  NULL;\nEND;";
    expect(stripTrailingSemicolon(sql)).toBe(sql);
  });

  it("adds a missing trailing ; for an anonymous PL/SQL block", () => {
    const sql = "BEGIN\n  NULL;\nEND";
    expect(stripTrailingSemicolon(sql)).toBe("BEGIN\n  NULL;\nEND;");
  });

  it("keeps the trailing ; for CREATE OR REPLACE PROCEDURE ... END;", () => {
    const sql = `CREATE OR REPLACE PROCEDURE foo AS
BEGIN
  NULL;
END;`;
    expect(stripTrailingSemicolon(sql)).toBe(sql);
  });

  it("keeps the trailing ; for CREATE FUNCTION ... END;", () => {
    const sql = "CREATE FUNCTION bar RETURN NUMBER IS\nBEGIN\n  RETURN 1;\nEND;";
    expect(stripTrailingSemicolon(sql)).toBe(sql);
  });

  it("keeps the trailing ; for CREATE PACKAGE BODY ... END;", () => {
    const sql = "CREATE OR REPLACE PACKAGE BODY pkg IS\nEND;";
    expect(stripTrailingSemicolon(sql)).toBe(sql);
  });
});

describe("findStatementRange", () => {
  it("gap after a ; belongs to the previous statement (DBeaver-style)", () => {
    const sql = "SELECT 1;\n\nSELECT 2;";
    const gapOffset = sql.indexOf("\n\n") + 1;
    const range = findStatementRange(sql, gapOffset);
    expect(sql.slice(range.start, range.end)).toBe("SELECT 1");
  });

  it("cursor inside the second statement selects it", () => {
    const sql = "SELECT 1; SELECT 2;";
    const range = findStatementRange(sql, sql.indexOf("SELECT 2") + 2);
    expect(sql.slice(range.start, range.end)).toBe(" SELECT 2");
  });

  it("cursor at EOF after the last statement selects the last statement", () => {
    const sql = "SELECT 1;";
    const range = findStatementRange(sql, sql.length);
    expect(sql.slice(range.start, range.end)).toBe("SELECT 1");
  });
});

describe("trimSqlRange", () => {
  it("trims whitespace and a trailing ;", () => {
    const content = "  SELECT 1;  ";
    const result = trimSqlRange(content, 0, content.length);
    expect(result.sql).toBe("SELECT 1");
  });
});

describe("statementsInRange", () => {
  it("splits every ; within the range", () => {
    const content = "SELECT 1; SELECT 2; SELECT 3;";
    const statements = statementsInRange(content, 0, content.length);
    expect(statements.map((s) => s.sql)).toEqual([
      "SELECT 1",
      "SELECT 2",
      "SELECT 3",
    ]);
  });

  it("a range with no ; still counts as one statement", () => {
    const content = "SELECT 1 FROM dual";
    const statements = statementsInRange(content, 0, content.length);
    expect(statements.map((s) => s.sql)).toEqual(["SELECT 1 FROM dual"]);
  });

  // A standalone `/` line is a SQL*Plus/SQLcl "run the buffer" client convention, not SQL — it
  // must never reach the DB as its own statement (Oracle rejects it with ORA-00900). A script
  // with two CREATE ... END; blocks, each followed by its own `/`, must produce exactly the two
  // real statements and silently drop both slash markers.
  it("drops a standalone `/` buffer-execute marker after each CREATE ... END; block", () => {
    const content = `CREATE OR REPLACE PROCEDURE p1 AS
BEGIN
  NULL;
END;
/
CREATE OR REPLACE PROCEDURE p2 AS
BEGIN
  NULL;
END;
/
`;
    const statements = statementsInRange(content, 0, content.length);
    expect(statements).toHaveLength(2);
    expect(statements[0].sql).toContain("PROCEDURE p1");
    expect(statements[1].sql).toContain("PROCEDURE p2");
    for (const statement of statements) {
      expect(statement.sql.trim()).not.toBe("/");
    }
  });

  it("a lone `/` with no preceding statement produces zero statements", () => {
    expect(statementsInRange("/", 0, 1)).toEqual([]);
    expect(statementsInRange("  \n/\n  ", 0, 7)).toEqual([]);
  });

  it("an ordinary SQL statement without any `/` is unaffected", () => {
    const content = "SELECT 1 FROM dual;";
    const statements = statementsInRange(content, 0, content.length);
    expect(statements.map((s) => s.sql)).toEqual(["SELECT 1 FROM dual"]);
  });

  it("the full reported repro script produces exactly one real statement", () => {
    const content = `CREATE OR REPLACE PROCEDURE hello_test (
  p_name IN VARCHAR2
) AS
BEGIN
  DBMS_OUTPUT.PUT_LINE('Hello, ' || p_name || '!');
END;
/
`;
    const statements = statementsInRange(content, 0, content.length);
    expect(statements).toHaveLength(1);
    expect(statements[0].sql.trim()).toBe(
      `CREATE OR REPLACE PROCEDURE hello_test (
  p_name IN VARCHAR2
) AS
BEGIN
  DBMS_OUTPUT.PUT_LINE('Hello, ' || p_name || '!');
END`,
    );
  });
});

describe("extractExecutableStatements", () => {
  it("non-empty selection runs every statement inside it", () => {
    const sql = "SELECT 1; SELECT 2; SELECT 3;";
    const result = extractExecutableStatements(sql, 0, sql.length);
    expect(result.mode).toBe("selection");
    expect(result.statements.map((s) => s.sql)).toEqual([
      "SELECT 1",
      "SELECT 2",
      "SELECT 3",
    ]);
  });

  it("no selection runs only the statement owned by the cursor", () => {
    const sql = "SELECT 1; SELECT 2;";
    const cursor = sql.indexOf("SELECT 2");
    const result = extractExecutableStatements(sql, cursor, cursor);
    expect(result.mode).toBe("statement");
    expect(result.statements.map((s) => s.sql)).toEqual(["SELECT 2"]);
  });

  it("cursor sitting on a standalone `/` marker produces no statement", () => {
    const sql = "CREATE OR REPLACE PROCEDURE p AS\nBEGIN\n  NULL;\nEND;\n/\n";
    const cursor = sql.indexOf("/");
    const result = extractExecutableStatements(sql, cursor, cursor);
    expect(result.statements).toEqual([]);
  });
});

describe("extractExecutableSql", () => {
  it("returns empty result for blank content", () => {
    const result = extractExecutableSql("", 0, 0);
    expect(result.sql).toBe("");
    expect(result.range).toEqual({ start: 0, end: 0 });
  });

  it("joins multiple selected statements with ;\\n", () => {
    const sql = "SELECT 1; SELECT 2;";
    const result = extractExecutableSql(sql, 0, sql.length);
    expect(result.sql).toBe("SELECT 1;\nSELECT 2");
  });
});
