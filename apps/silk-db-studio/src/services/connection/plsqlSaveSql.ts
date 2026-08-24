import type { MetadataObjectKind } from "@silk-studio/db-protocol";
import { stripTrailingSemicolon } from "../query/sqlExecutable";
import { qualifyTableName } from "../query/sqlLiteral";
import type { ConnectionDriverId } from "./connectionTypes";
import type { PlsqlEditorRef } from "./plsqlEditorConstants";

export type PlsqlSaveSqlResult = {
  /**
   * One statement for every driver/kind except MySQL/MariaDB procedures/functions, which have
   * no `CREATE OR REPLACE` and so need a `DROP IF EXISTS` + `CREATE` pair (two statements) —
   * see the MySQL/MariaDB branch below. Always execute in array order.
   */
  statements: string[];
  warnings: string[];
};

function oracleKindKeyword(kind: MetadataObjectKind): string {
  switch (kind) {
    case "procedure":
      return "PROCEDURE";
    case "function":
      return "FUNCTION";
    case "package":
      return "PACKAGE";
    case "view":
      return "VIEW";
    default:
      throw new Error(`Unsupported PL/SQL object kind: ${kind}`);
  }
}

function normalizeIdent(name: string): string {
  const trimmed = name.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith("`") && trimmed.endsWith("`"))
  ) {
    return trimmed.slice(1, -1);
  }
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1);
  }
  return trimmed.toUpperCase();
}

function namesEqual(a: string, b: string): boolean {
  return normalizeIdent(a) === normalizeIdent(b);
}

/**
 * Best-effort object name from a CREATE [OR REPLACE] header.
 * Handles schema.object and quoted identifiers.
 */
export function extractPlsqlObjectName(
  sql: string,
  kind: MetadataObjectKind,
): string | null {
  const keyword = oracleKindKeyword(kind);
  // Identifier token: double-quoted (Oracle/Postgres), backtick-quoted (MySQL/MariaDB),
  // square-bracket-quoted (SQL Server), or bare.
  const identToken =
    String.raw`(?:"[^"]+"|` + "`[^`]+`" + String.raw`|\[[^\]]+\]|[A-Za-z_][\w$#]*)`;
  const header = new RegExp(
    String.raw`^\s*(?:CREATE(?:\s+OR\s+REPLACE)?|ALTER)\s+(?:EDITIONABLE\s+|NONEDITIONABLE\s+)?(?:${keyword})(?:\s+BODY)?\s+(${identToken}(?:\s*\.\s*${identToken})?)`,
    "i",
  );
  const match = header.exec(sql);
  if (!match) return null;
  const qualified = match[1].replace(/\s+/g, "");
  const parts = qualified.split(".");
  const bare = parts[parts.length - 1] ?? "";
  return (
    bare
      .replace(/^"|"$/g, "")
      .replace(/^`|`$/g, "")
      .replace(/^\[|\]$/g, "") || null
  );
}

/**
 * Build the DDL to execute for PL/SQL Save.
 * Oracle DBMS_METADATA usually already returns CREATE OR REPLACE; otherwise
 * we rewrite plain CREATE → CREATE OR REPLACE. Trailing `/` and `;` are stripped
 * for JDBC.
 */
export function buildPlsqlSaveSql(
  content: string,
  ref: PlsqlEditorRef,
  driverId: ConnectionDriverId,
): PlsqlSaveSqlResult {
  const warnings: string[] = [];
  let body = content.replace(/^\uFEFF/, "").trim();
  if (!body) {
    throw new Error("Source is empty. Nothing to save.");
  }
  if (
    body.startsWith("-- Loading source") ||
    body.startsWith("-- Failed to load source")
  ) {
    throw new Error("Source is not loaded yet.");
  }

  // SQL*Plus style terminator sometimes appended after DBMS_METADATA.
  body = body.replace(/(?:^|\n)\s*\/\s*$/, "").trimEnd();

  let sql = stripTrailingSemicolon(body);
  if (!sql.trim()) {
    throw new Error("Source is empty. Nothing to save.");
  }

  const isSqlServer = driverId === "sqlserver";
  // MySQL/MariaDB support CREATE OR REPLACE for views/triggers but NOT for procedures/
  // functions — those need a DROP IF EXISTS + CREATE pair instead (same approach DBeaver's
  // MySQLProcedureManager uses, DEFINER clause and all — no attempt is made to strip it).
  // Both statements auto-commit immediately in MySQL regardless of any surrounding
  // transaction (DDL isn't transactional there): if CREATE fails after DROP already
  // succeeded, the object is genuinely gone until re-created from a snapshot or the
  // save dialog's still-visible "before" diff text.
  const needsDropCreate =
    (driverId === "mysql" || driverId === "mariadb") &&
    (ref.kind === "procedure" || ref.kind === "function");
  const startsWithCreate = /^\s*CREATE\b/i.test(sql);
  const startsWithAlter = /^\s*ALTER\b/i.test(sql);

  if (!startsWithCreate && !(isSqlServer && startsWithAlter)) {
    const keyword =
      ref.kind === "package" && ref.packageBody
        ? "PACKAGE BODY"
        : oracleKindKeyword(ref.kind);
    const expected = isSqlServer
      ? `CREATE or ALTER ${keyword}`
      : `CREATE (OR REPLACE) ${keyword}`;
    throw new Error(
      `Source must start with ${expected}. Paste a full object definition before saving.`,
    );
  }

  if (isSqlServer) {
    // SQL Server has no CREATE OR REPLACE VIEW/PROCEDURE/FUNCTION; this editor only ever edits
    // an existing object, so rewrite a leading CREATE to ALTER. A buffer already starting with
    // ALTER (re-saving after a prior save already did this rewrite) is left as-is.
    if (startsWithCreate) {
      sql = sql.replace(/^\s*CREATE\b/i, "ALTER");
      warnings.push("Rewrote CREATE to ALTER (SQL Server has no CREATE OR REPLACE).");
    }
  } else if (needsDropCreate) {
    // Leave a leading CREATE exactly as fetched — no OR REPLACE rewrite (invalid syntax for
    // MySQL/MariaDB routines). The DROP statement built below handles the "replace" half.
  } else if (/^\s*CREATE\s+(?!OR\s+REPLACE\b)/i.test(sql)) {
    sql = sql.replace(/^\s*CREATE\b/i, "CREATE OR REPLACE");
    warnings.push("Rewrote CREATE to CREATE OR REPLACE.");
  }

  const isBodySql = /^\s*CREATE(?:\s+OR\s+REPLACE)?\s+(?:EDITIONABLE\s+|NONEDITIONABLE\s+)?PACKAGE\s+BODY\b/i.test(
    sql,
  );
  if (ref.kind === "package") {
    if (ref.packageBody && !isBodySql) {
      warnings.push(
        "This tab is PACKAGE BODY, but the buffer does not look like CREATE PACKAGE BODY.",
      );
    }
    if (!ref.packageBody && isBodySql) {
      warnings.push(
        "This tab is PACKAGE SPEC, but the buffer looks like CREATE PACKAGE BODY.",
      );
    }
  }

  const definedName = extractPlsqlObjectName(sql, ref.kind);
  if (definedName && !namesEqual(definedName, ref.objectName)) {
    warnings.push(
      `Buffer defines "${definedName}" but this tab is "${ref.objectName}".`,
    );
  }

  const createStatement = stripTrailingSemicolon(sql);

  if (needsDropCreate) {
    const dropStatement = `DROP ${oracleKindKeyword(ref.kind)} IF EXISTS ${qualifyTableName(
      ref.schemaName,
      ref.objectName,
      driverId,
    )}`;
    warnings.push(
      "MySQL/MariaDB has no CREATE OR REPLACE for procedures/functions — this DROPs and " +
        "recreates the object as two separate statements (see the SQL tab).",
    );
    return { statements: [dropStatement, createStatement], warnings };
  }

  return { statements: [createStatement], warnings };
}
