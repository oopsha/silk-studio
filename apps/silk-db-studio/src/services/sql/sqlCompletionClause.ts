/**
 * Heuristic SQL clause detection for IntelliSense (I-A).
 * Not a full parser — finds the last clause keyword in the current statement prefix.
 */

export type SqlClause =
  | "statement_start"
  | "select_list"
  | "from"
  | "join"
  | "on"
  | "where"
  | "group_by"
  | "having"
  | "order_by"
  | "insert"
  | "values"
  | "update"
  | "set"
  | "unknown";

type ClausePattern = {
  clause: SqlClause;
  /** Global regex; last match wins. */
  pattern: RegExp;
};

const CLAUSE_PATTERNS: ClausePattern[] = [
  { clause: "select_list", pattern: /\bSELECT\b/gi },
  { clause: "from", pattern: /\bFROM\b/gi },
  {
    clause: "join",
    pattern: /\b(?:(?:LEFT|RIGHT|FULL|INNER|CROSS|OUTER)\s+)*JOIN\b/gi,
  },
  { clause: "on", pattern: /\bON\b/gi },
  { clause: "where", pattern: /\bWHERE\b/gi },
  { clause: "group_by", pattern: /\bGROUP\s+BY\b/gi },
  { clause: "having", pattern: /\bHAVING\b/gi },
  { clause: "order_by", pattern: /\bORDER\s+BY\b/gi },
  { clause: "insert", pattern: /\bINSERT\b/gi },
  { clause: "values", pattern: /\bVALUES\b/gi },
  { clause: "update", pattern: /\bUPDATE\b/gi },
  { clause: "set", pattern: /\bSET\b/gi },
];

/** Strip line and block comments for simpler keyword scans. */
export function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n\r]*/g, " ");
}

/**
 * Text before the cursor belonging to the current statement
 * (after the last `;` outside of simple quotes).
 */
export function extractStatementPrefix(textBeforeCursor: string): string {
  const cleaned = stripSqlComments(textBeforeCursor);
  const lastSemi = findLastSemicolonOutsideQuotes(cleaned);
  return cleaned.slice(lastSemi + 1);
}

/**
 * Full current statement (prefix + suffix) so FROM after the cursor
 * still contributes relations for `SELECT e.| FROM emp e`.
 */
export function extractCurrentStatement(
  textBeforeCursor: string,
  textAfterCursor: string,
): { statement: string; prefix: string } {
  const prefix = extractStatementPrefix(textBeforeCursor);
  const after = stripSqlComments(textAfterCursor);
  const nextSemi = findFirstSemicolonOutsideQuotes(after);
  const suffix = nextSemi < 0 ? after : after.slice(0, nextSemi);
  return { statement: prefix + suffix, prefix };
}

function findLastSemicolonOutsideQuotes(text: string): number {
  let inSingle = false;
  let inDouble = false;
  let lastSemi = -1;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "'" && !inDouble) {
      if (inSingle && text[i + 1] === "'") {
        i += 1;
        continue;
      }
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (ch === ";" && !inSingle && !inDouble) {
      lastSemi = i;
    }
  }
  return lastSemi;
}

function findFirstSemicolonOutsideQuotes(text: string): number {
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "'" && !inDouble) {
      if (inSingle && text[i + 1] === "'") {
        i += 1;
        continue;
      }
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (ch === ";" && !inSingle && !inDouble) {
      return i;
    }
  }
  return -1;
}

/** Replace single-quoted string bodies with spaces (double quotes are identifiers). */
export function maskSqlStrings(sql: string): string {
  let result = "";
  let inSingle = false;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === "'") {
      // SQL escaped quote: ''
      if (inSingle && sql[i + 1] === "'") {
        result += "  ";
        i += 1;
        continue;
      }
      inSingle = !inSingle;
      result += " ";
      continue;
    }
    if (inSingle) {
      result += ch === "\n" || ch === "\r" ? ch : " ";
      continue;
    }
    result += ch;
  }
  return result;
}

export function detectSqlClause(statementPrefix: string): SqlClause {
  const text = maskSqlStrings(statementPrefix);
  if (!text.trim()) {
    return "statement_start";
  }

  let best: { clause: SqlClause; index: number } | null = null;

  for (const { clause, pattern } of CLAUSE_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const index = match.index;
      if (!best || index >= best.index) {
        best = { clause, index };
      }
    }
  }

  if (!best) {
    // Typing the first word of a statement (e.g. "SEL").
    return "statement_start";
  }

  // INSERT … VALUES / INSERT … SELECT handled by last keyword.
  // UPDATE … SET → set; UPDATE alone / UPDATE t → update (table position).
  return best.clause;
}

/** Whether this clause is primarily a relation (table/schema) position. */
export function isRelationClause(clause: SqlClause): boolean {
  return (
    clause === "from" ||
    clause === "join" ||
    clause === "insert" ||
    clause === "update"
  );
}

/** Whether this clause is primarily an expression position (functions/columns). */
export function isExpressionClause(clause: SqlClause): boolean {
  return (
    clause === "select_list" ||
    clause === "where" ||
    clause === "having" ||
    clause === "on" ||
    clause === "group_by" ||
    clause === "order_by" ||
    clause === "set" ||
    clause === "values"
  );
}
