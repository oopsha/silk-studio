import { describe, expect, it } from "vitest";
import { extractCurrentStatement } from "./sqlCompletionClause";
import {
  findRelationByQualifier,
  parseSqlRelations,
} from "./sqlCompletionRelations";

describe("parseSqlRelations", () => {
  it("parses FROM table with alias", () => {
    expect(parseSqlRelations("SELECT * FROM emp e WHERE e.")).toEqual([
      { table: "emp", alias: "e" },
    ]);
  });

  it("parses FROM table without alias", () => {
    expect(parseSqlRelations("SELECT * FROM emp WHERE ")).toEqual([
      { table: "emp", alias: "emp" },
    ]);
  });

  it("parses AS alias and schema.table", () => {
    expect(
      parseSqlRelations("SELECT * FROM hr.employees AS e JOIN dept d ON "),
    ).toEqual([
      { schema: "hr", table: "employees", alias: "e" },
      { table: "dept", alias: "d" },
    ]);
  });

  it("parses comma joins", () => {
    expect(parseSqlRelations("SELECT * FROM emp e, dept d WHERE ")).toEqual([
      { table: "emp", alias: "e" },
      { table: "dept", alias: "d" },
    ]);
  });

  it("does not treat JOIN keywords as aliases", () => {
    expect(
      parseSqlRelations("SELECT * FROM emp LEFT JOIN dept ON emp.id = dept.id"),
    ).toEqual([
      { table: "emp", alias: "emp" },
      { table: "dept", alias: "dept" },
    ]);
  });

  it("parses derived-table subqueries with inferred columns", () => {
    expect(
      parseSqlRelations(
        "SELECT * FROM (SELECT id FROM x) t JOIN emp e ON t.id = e.id",
      ),
    ).toEqual([
      { table: "t", alias: "t", columns: ["id"] },
      { table: "emp", alias: "e" },
    ]);
  });

  it("parses quoted and bracket identifiers", () => {
    expect(
      parseSqlRelations('SELECT * FROM "HR"."EMP" e JOIN [dbo].[dept] d ON '),
    ).toEqual([
      { schema: "HR", table: "EMP", alias: "e" },
      { schema: "dbo", table: "dept", alias: "d" },
    ]);
  });

  it("parses UPDATE alias", () => {
    expect(parseSqlRelations("UPDATE emp e SET e.name = ")).toEqual([
      { table: "emp", alias: "e" },
    ]);
  });
});

describe("findRelationByQualifier", () => {
  const relations = parseSqlRelations(
    "SELECT * FROM emp e JOIN dept d ON e.dept_id = d.id",
  );

  it("resolves alias and table name", () => {
    expect(findRelationByQualifier(relations, "e")?.table).toBe("emp");
    expect(findRelationByQualifier(relations, "DEPT")?.alias).toBe("d");
  });
});

describe("extractCurrentStatement", () => {
  it("includes FROM after the cursor for SELECT list completion", () => {
    const { statement, prefix } = extractCurrentStatement(
      "SELECT e.",
      " FROM emp e WHERE 1=1; SELECT 2",
    );
    expect(prefix).toBe("SELECT e.");
    expect(statement).toContain("FROM emp e");
    expect(parseSqlRelations(statement)).toEqual([
      { table: "emp", alias: "e" },
    ]);
  });
});
