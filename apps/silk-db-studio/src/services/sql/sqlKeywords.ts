import type { ConnectionDriverId } from "../connection/connectionTypes";
import { functionsForDriver } from "./sqlFunctions";

export { functionsForDriver } from "./sqlFunctions";

/** Statement-starting keywords (empty editor / after `;`). */
export const STATEMENT_START_KEYWORDS = [
  "SELECT",
  "WITH",
  "INSERT",
  "UPDATE",
  "DELETE",
  "MERGE",
  "CREATE",
  "ALTER",
  "DROP",
  "TRUNCATE",
  "GRANT",
  "REVOKE",
  "COMMIT",
  "ROLLBACK",
  "BEGIN",
  "DECLARE",
  "USE",
  "CALL",
  "EXEC",
  "EXECUTE",
  "EXPLAIN",
] as const;

/** Structural / clause keywords (not functions). */
const STRUCTURAL_KEYWORDS = [
  "SELECT",
  "FROM",
  "WHERE",
  "INSERT",
  "INTO",
  "VALUES",
  "UPDATE",
  "SET",
  "DELETE",
  "JOIN",
  "LEFT",
  "RIGHT",
  "INNER",
  "OUTER",
  "FULL",
  "CROSS",
  "ON",
  "AS",
  "GROUP",
  "BY",
  "ORDER",
  "HAVING",
  "DISTINCT",
  "ALL",
  "UNION",
  "INTERSECT",
  "EXCEPT",
  "WITH",
  "CREATE",
  "ALTER",
  "DROP",
  "TABLE",
  "VIEW",
  "INDEX",
  "TRUNCATE",
  "GRANT",
  "REVOKE",
  "COMMIT",
  "ROLLBACK",
  "BEGIN",
  "DECLARE",
  "IF",
  "LOOP",
  "WHILE",
  "FOR",
  "RETURN",
  "MERGE",
  "USING",
  "MATCHED",
  "LIMIT",
  "OFFSET",
  "FETCH",
  "NEXT",
  "ONLY",
  "TOP",
  "APPLY",
  "PIVOT",
  "UNPIVOT",
  "GO",
  "RETURNING",
  "CONNECT",
  "PRIOR",
  "START",
  "MINUS",
  "SEQUENCE",
  "TRIGGER",
  "PACKAGE",
  "PROCEDURE",
  "FUNCTION",
] as const;

/** Keywords valid inside expressions (AND/OR/CASE/…). */
const EXPRESSION_KEYWORDS = [
  "AS",
  "AND",
  "OR",
  "NOT",
  "NULL",
  "IS",
  "IN",
  "EXISTS",
  "BETWEEN",
  "LIKE",
  "ILIKE",
  "SIMILAR",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "DISTINCT",
  "ALL",
  "TRUE",
  "FALSE",
  "ASC",
  "DESC",
  "OVER",
  "PARTITION",
] as const;

const ORACLE_KEYWORD_EXTRA = [
  "DUAL",
  "ROWNUM",
  "ROWID",
  "VARCHAR2",
  "NUMBER",
  "CLOB",
  "BLOB",
  "RAW",
  "DBMS_OUTPUT",
] as const;

const TSQL_KEYWORD_EXTRA = [
  "NOLOCK",
  "HOLDLOCK",
  "UPDLOCK",
  "ROWLOCK",
  "IDENTITY",
  "OUTPUT",
  "TRY",
  "CATCH",
  "THROW",
  "NVARCHAR",
  "DATETIME2",
  "UNIQUEIDENTIFIER",
] as const;

const MYSQL_KEYWORD_EXTRA = [
  "AUTO_INCREMENT",
  "REPLACE",
  "IGNORE",
  "DUPLICATE",
  "KEY",
  "FORCE",
  "USE",
  "INDEX",
] as const;

const PG_KEYWORD_EXTRA = [
  "ARRAY",
  "JSONB",
  "SERIAL",
  "BIGSERIAL",
] as const;

const DRIVER_KEYWORD_EXTRAS: Record<ConnectionDriverId, readonly string[]> = {
  oracle: ORACLE_KEYWORD_EXTRA,
  sqlserver: TSQL_KEYWORD_EXTRA,
  mysql: MYSQL_KEYWORD_EXTRA,
  mariadb: MYSQL_KEYWORD_EXTRA,
  postgresql: PG_KEYWORD_EXTRA,
};

function uniqueWords(words: Iterable<string>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const word of words) {
    const key = word.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(word);
  }
  return result;
}

export function statementStartKeywordsForDriver(
  driverId: ConnectionDriverId,
): string[] {
  const extra =
    driverId === "mysql" || driverId === "mariadb"
      ? (["USE", "REPLACE"] as const)
      : driverId === "sqlserver"
        ? (["EXEC", "EXECUTE", "GO"] as const)
        : [];
  return uniqueWords([...STATEMENT_START_KEYWORDS, ...extra]);
}

/** Non-function keywords (structural + expression + driver keyword extras). */
export function keywordsForDriver(driverId: ConnectionDriverId): string[] {
  return uniqueWords([
    ...STRUCTURAL_KEYWORDS,
    ...EXPRESSION_KEYWORDS,
    ...DRIVER_KEYWORD_EXTRAS[driverId],
  ]);
}

export function expressionKeywordsForDriver(
  driverId: ConnectionDriverId,
): string[] {
  return uniqueWords([
    ...EXPRESSION_KEYWORDS,
    ...DRIVER_KEYWORD_EXTRAS[driverId].filter((word) =>
      ["ROWNUM", "ROWID", "DUAL"].includes(word.toUpperCase()),
    ),
  ]);
}

/** Keywords useful while writing FROM / JOIN lists. */
export function fromClauseKeywordsForDriver(
  driverId: ConnectionDriverId,
): string[] {
  return uniqueWords([
    "JOIN",
    "LEFT",
    "RIGHT",
    "INNER",
    "OUTER",
    "FULL",
    "CROSS",
    "AS",
    "ON",
    "WHERE",
    "GROUP",
    "BY",
    "ORDER",
    "HAVING",
    "UNION",
    "INTERSECT",
    "EXCEPT",
    "LIMIT",
    "OFFSET",
    "FETCH",
    "WITH",
    ...(driverId === "oracle" ? (["DUAL"] as const) : []),
    ...(driverId === "sqlserver" ? (["APPLY", "PIVOT", "UNPIVOT"] as const) : []),
  ]);
}

/** Continuers after a SELECT list (need FROM, etc.). */
export function selectListKeywords(): string[] {
  return uniqueWords([
    "FROM",
    "INTO",
    "AS",
    "DISTINCT",
    "ALL",
    "CASE",
    "WHEN",
    "THEN",
    "ELSE",
    "END",
    "AND",
    "OR",
    "NOT",
    "NULL",
    "IS",
    "IN",
    "EXISTS",
    "BETWEEN",
    "LIKE",
  ]);
}

/** @deprecated Prefer clause-specific helpers; kept for callers that want all non-function keywords. */
export function allCompletionWordsForDriver(
  driverId: ConnectionDriverId,
): string[] {
  return uniqueWords([
    ...keywordsForDriver(driverId),
    ...functionsForDriver(driverId),
  ]);
}
