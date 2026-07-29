import type { MetadataObjectKind } from "@silk-studio/db-protocol";
import { stripTrailingSemicolon } from "../query/sqlExecutable";
import type { PlsqlEditorRef } from "./plsqlEditorConstants";

export type PlsqlSaveSqlResult = {
  sql: string;
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
    default:
      throw new Error(`Unsupported PL/SQL object kind: ${kind}`);
  }
}

function normalizeIdent(name: string): string {
  const trimmed = name.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
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
  const header = new RegExp(
    String.raw`^\s*CREATE(?:\s+OR\s+REPLACE)?\s+(?:EDITIONABLE\s+|NONEDITIONABLE\s+)?(?:${keyword})(?:\s+BODY)?\s+((?:"[^"]+"|[A-Za-z_][\w$#]*)(?:\s*\.\s*(?:"[^"]+"|[A-Za-z_][\w$#]*))?)`,
    "i",
  );
  const match = header.exec(sql);
  if (!match) return null;
  const qualified = match[1].replace(/\s+/g, "");
  const parts = qualified.split(".");
  const bare = parts[parts.length - 1] ?? "";
  return bare.replace(/^"|"$/g, "") || null;
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

  if (!/^\s*CREATE\b/i.test(sql)) {
    const keyword = oracleKindKeyword(ref.kind);
    throw new Error(
      `Source must start with CREATE (OR REPLACE) ${keyword}. Paste a full object definition before saving.`,
    );
  }

  if (/^\s*CREATE\s+(?!OR\s+REPLACE\b)/i.test(sql)) {
    sql = sql.replace(/^\s*CREATE\b/i, "CREATE OR REPLACE");
    warnings.push("Rewrote CREATE to CREATE OR REPLACE.");
  }

  const definedName = extractPlsqlObjectName(sql, ref.kind);
  if (definedName && !namesEqual(definedName, ref.objectName)) {
    warnings.push(
      `Buffer defines "${definedName}" but this tab is "${ref.objectName}".`,
    );
  }

  return { sql: stripTrailingSemicolon(sql), warnings };
}
