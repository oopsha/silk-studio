export type SqlTableReference = {
  catalog: string | null;
  schema: string | null;
  table: string;
};

/**
 * Matches only when the tail *starts* with another table reference (join/union/comma).
 * Anchored to the start so it doesn't false-positive on JOIN/UNION appearing inside a
 * nested subquery further down the tail (e.g. `WHERE x IN (SELECT ... JOIN ...)`).
 */
const UNSUPPORTED_AFTER_TABLE =
  /^\s*(?:,|union\b|intersect\b|except\b|(?:cross\s+|inner\s+|left\s+(?:outer\s+)?|right\s+(?:outer\s+)?|full\s+(?:outer\s+)?)?join\b)/i;

/** Do not treat clause keywords (e.g. WHERE) as a table alias after the table name. */
const OPTIONAL_TABLE_ALIAS =
  "(?:\\s+(?:as\\s+)?(?!where\\b|group\\b|having\\b|order\\b|limit\\b|offset\\b|fetch\\b|for\\b|inner\\b|left\\b|right\\b|full\\b|cross\\b|join\\b|union\\b)[`\"\\[]?[\\w$#]+[`\"\\]]?)?";

/**
 * Strips `-- line` and `/* block *\/` comments (outside quoted strings) so a leading note
 * above the query (e.g. `-- description`) doesn't make it look like a non-SELECT statement,
 * and comment text can't accidentally contain words like JOIN/UNION that confuse the scan below.
 */
export function stripSqlComments(sql: string): string {
  let result = "";
  let quote: string | null = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (quote) {
      result += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      result += ch;
      continue;
    }
    if (ch === "-" && sql[i + 1] === "-") {
      const lineEnd = sql.indexOf("\n", i);
      result += " ";
      if (lineEnd === -1) break;
      i = lineEnd - 1;
      continue;
    }
    if (ch === "/" && sql[i + 1] === "*") {
      const commentEnd = sql.indexOf("*/", i + 2);
      result += " ";
      if (commentEnd === -1) break;
      i = commentEnd + 1;
      continue;
    }
    result += ch;
  }
  return result;
}

/**
 * Blanks out parenthesized groups and quoted string contents (preserving length/positions)
 * so top-level keyword scans don't false-positive on JOIN/UNION/etc. that only appear inside
 * a nested subquery or a string literal.
 */
function maskParenthesizedGroups(sql: string): string {
  let result = "";
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (quote) {
      result += ch === quote ? ch : depth > 0 ? " " : ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      result += depth > 0 ? " " : ch;
      continue;
    }
    if (ch === "(") {
      depth++;
      result += " ";
      continue;
    }
    if (ch === ")") {
      depth = Math.max(0, depth - 1);
      result += " ";
      continue;
    }
    result += depth > 0 ? " " : ch;
  }
  return result;
}

/**
 * Extract a single base table from a simple `SELECT … FROM …` statement.
 * Returns null for joins, unions, subqueries, or non-SELECT statements.
 */
export function parseSingleTableFromSelect(sql: string): SqlTableReference | null {
  const normalized = stripSqlComments(sql).trim().replace(/;\s*$/, "");
  if (!/^\s*select\b/i.test(normalized)) {
    return null;
  }

  const masked = maskParenthesizedGroups(normalized);
  if (/\bunion\b|\bintersect\b|\bexcept\b/i.test(masked)) {
    return null;
  }

  const fromMatch = masked.match(/\bfrom\b/i);
  if (!fromMatch || fromMatch.index === undefined) {
    return null;
  }

  let rest = normalized.slice(fromMatch.index + fromMatch[0].length).trim();
  if (!rest || rest.startsWith("(")) {
    return null;
  }

  // Up to 3 dotted parts: table, schema.table, or database.schema.table
  // (SQL Server-style). The database segment is returned as `catalog` so
  // callers can query/edit the right catalog without switching the shared
  // JDBC session (see connection/connectionTreeService.ts, 4단계).
  const chain = readDottedIdentifierChain(rest, 3);
  if (!chain) {
    return null;
  }

  const afterIdent = rest.slice(chain.end);
  const aliasMatch = afterIdent.match(new RegExp(`^${OPTIONAL_TABLE_ALIAS}`, "i"));
  const remainder = afterIdent.slice(aliasMatch?.[0].length ?? 0).trim();
  if (!isAllowedTableTail(remainder)) {
    return null;
  }

  const { parts } = chain;
  return {
    catalog: parts.length >= 3 ? parts[parts.length - 3] : null,
    schema: parts.length >= 2 ? parts[parts.length - 2] : null,
    table: parts[parts.length - 1],
  };
}

/**
 * Reads a single (possibly quoted) identifier at `text[pos]`. Handles the
 * asymmetric SQL Server `[ident]` bracket form as well as symmetric `"ident"`
 * / `` `ident` `` quoting and bare identifiers.
 */
function readIdentifier(
  text: string,
  pos: number,
): { value: string; end: number } | null {
  const ch = text[pos];
  if (ch === '"' || ch === "`") {
    const close = text.indexOf(ch, pos + 1);
    if (close === -1) return null;
    return { value: text.slice(pos + 1, close), end: close + 1 };
  }
  if (ch === "[") {
    const close = text.indexOf("]", pos + 1);
    if (close === -1) return null;
    return { value: text.slice(pos + 1, close), end: close + 1 };
  }
  const match = /^[\w$#]+/.exec(text.slice(pos));
  if (!match) return null;
  return { value: match[0], end: pos + match[0].length };
}

/** Reads up to `maxParts` dot-separated identifiers starting at index 0. */
function readDottedIdentifierChain(
  text: string,
  maxParts: number,
): { parts: string[]; end: number } | null {
  const parts: string[] = [];
  let pos = 0;
  for (;;) {
    const ident = readIdentifier(text, pos);
    if (!ident) break;
    parts.push(ident.value);
    pos = ident.end;
    if (parts.length >= maxParts) break;
    const dotMatch = /^\s*\.\s*/.exec(text.slice(pos));
    if (!dotMatch) break;
    pos += dotMatch[0].length;
  }
  return parts.length > 0 ? { parts, end: pos } : null;
}

function isAllowedTableTail(remainder: string): boolean {
  if (!remainder) {
    return true;
  }
  if (UNSUPPORTED_AFTER_TABLE.test(remainder)) {
    return false;
  }
  return /^\s*(where|group\s+by|having|order\s+by|limit|offset|fetch|for\s+update)\b/i.test(
    remainder,
  );
}
