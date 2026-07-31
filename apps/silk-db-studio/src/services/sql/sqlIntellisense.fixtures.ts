/**
 * Shared IntelliSense fixtures for I-A / I-B / I-C regression tests and docs.
 * Cursor is implied at the end of `sql` unless `cursorAt` is set (index into `sql`).
 */

export type ClauseFixture = {
  id: string;
  sql: string;
  expectClause: string;
};

export type RelationFixture = {
  id: string;
  sql: string;
  expectRelations: Array<{
    table: string;
    alias: string;
    schema?: string;
    columns?: string[];
  }>;
};

export type ScopeFixture = {
  id: string;
  sql: string;
  /** Defaults to sql.length */
  cursorAt?: number;
  expectAliases: string[];
  expectCteNames?: string[];
  /** CTE / derived column checks keyed by relation alias */
  expectColumnsByAlias?: Record<string, string[]>;
};

/** I-A: clause detection at end of string. */
export const CLAUSE_FIXTURES: ClauseFixture[] = [
  { id: "empty", sql: "", expectClause: "statement_start" },
  { id: "typing-select", sql: "SEL", expectClause: "statement_start" },
  { id: "select-list", sql: "SELECT ", expectClause: "select_list" },
  { id: "from", sql: "SELECT * FROM ", expectClause: "from" },
  {
    id: "join",
    sql: "SELECT * FROM emp e JOIN ",
    expectClause: "join",
  },
  {
    id: "where",
    sql: "SELECT * FROM emp WHERE ",
    expectClause: "where",
  },
  {
    id: "order-by",
    sql: "SELECT a FROM t ORDER BY ",
    expectClause: "order_by",
  },
];

/** I-B: FROM / JOIN alias parsing (depth-0 relations). */
export const RELATION_FIXTURES: RelationFixture[] = [
  {
    id: "alias-e",
    sql: "SELECT * FROM emp e WHERE e.",
    expectRelations: [{ table: "emp", alias: "e" }],
  },
  {
    id: "no-alias",
    sql: "SELECT * FROM emp WHERE ",
    expectRelations: [{ table: "emp", alias: "emp" }],
  },
  {
    id: "join-aliases",
    sql: "SELECT * FROM emp e JOIN dept d ON e.",
    expectRelations: [
      { table: "emp", alias: "e" },
      { table: "dept", alias: "d" },
    ],
  },
  {
    id: "schema-as",
    sql: "SELECT * FROM hr.employees AS e JOIN dept d ON ",
    expectRelations: [
      { schema: "hr", table: "employees", alias: "e" },
      { table: "dept", alias: "d" },
    ],
  },
];

/** I-C: CTE + subquery scope (parseSqlQueryScope). */
export const SCOPE_FIXTURES: ScopeFixture[] = [
  {
    id: "cte-columns",
    sql: "WITH c AS (SELECT id FROM t) SELECT * FROM c WHERE c.",
    expectAliases: ["c"],
    expectCteNames: ["c"],
    expectColumnsByAlias: { c: ["id"] },
  },
  {
    id: "subquery-inner-only",
    sql: "SELECT * FROM emp e WHERE e.id IN (SELECT x FROM dept d WHERE d.",
    expectAliases: ["d"],
  },
  {
    id: "derived-table",
    sql: "SELECT * FROM (SELECT id, name FROM emp) t WHERE t.",
    expectAliases: ["t"],
    expectColumnsByAlias: { t: ["id", "name"] },
  },
  {
    id: "cte-body-prior-only",
    sql: "WITH a AS (SELECT id FROM t), b AS (SELECT a.id FROM a WHERE a.x = 1) SELECT * FROM b",
    cursorAt: undefined, // filled in test via indexOf
    expectAliases: ["a"],
    expectCteNames: ["a"],
    expectColumnsByAlias: { a: ["id"] },
  },
];

/** Manual / user-facing scenarios (docs). Not all are auto-asserted. */
export const MANUAL_SCENARIOS = [
  {
    id: "no-abs-empty",
    when: "Empty editor, Ctrl+Space",
    expect: "Statement starters only (SELECT, WITH, …) — no ABS/COUNT",
  },
  {
    id: "select-functions",
    when: "After SELECT ",
    expect: "Columns (if FROM known) and dialect functions (e.g. TO_CHAR on Oracle)",
  },
  {
    id: "from-tables",
    when: "After FROM ",
    expect: "Schemas / tables / CTEs — not expression functions",
  },
  {
    id: "alias-dot",
    when: "FROM emp e … then e.",
    expect: "Columns of emp",
  },
  {
    id: "cte-dot",
    when: "WITH c AS (SELECT id FROM t) SELECT * FROM c WHERE c.",
    expect: "Column id (CTE)",
  },
  {
    id: "nested-from",
    when: "Outer FROM emp, cursor inside (SELECT … FROM dept d WHERE d.",
    expect: "dept columns only — not emp",
  },
  {
    id: "snippet",
    when: "Accept NVL / ISNULL from suggest",
    expect: "Snippet with tab stops, then signature help on (",
  },
] as const;
