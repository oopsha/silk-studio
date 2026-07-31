import {
  maskSqlStrings,
  stripSqlComments,
} from "./sqlCompletionClause";
import { inferSelectListColumns } from "./sqlCompletionSelectList";
import {
  parseSqlRelations,
  type SqlRelationRef,
} from "./sqlCompletionRelations";

export type SqlCteDef = {
  name: string;
  columns: string[];
  /** Inclusive start / exclusive end of AS ( … ) body content. */
  bodyStart: number;
  bodyEnd: number;
};

export type SqlQueryScope = {
  ctes: SqlCteDef[];
  visibleCtes: SqlCteDef[];
  relations: SqlRelationRef[];
  /** Slice of the statement used for FROM/JOIN parsing. */
  scopeText: string;
};

const IDENT_RE =
  /^(?:[A-Za-z_\u0080-\uFFFF][\w\u0080-\uFFFF$]*|"[^"]+"|\[[^\]]+\])/;

/**
 * Parse `WITH [RECURSIVE] name [(cols)] AS (body) [, …]` definitions.
 */
export function parseSqlCtes(statement: string): SqlCteDef[] {
  const text = maskSqlStrings(stripSqlComments(statement));
  let i = skipWs(text, 0);
  if (!matchKeyword(text, i, "WITH")) return [];
  i = skipWs(text, i + 4);
  if (matchKeyword(text, i, "RECURSIVE")) {
    i = skipWs(text, i + "RECURSIVE".length);
  }

  const ctes: SqlCteDef[] = [];

  while (i < text.length) {
    const nameTok = readIdent(text, i);
    if (!nameTok) break;
    // Main query keyword — end of CTE list
    if (isMainQueryStart(nameTok.value)) break;

    i = skipWs(text, nameTok.end);
    let explicitCols: string[] | null = null;

    if (text[i] === "(") {
      const colEnd = skipBalancedParen(text, i);
      const colList = text.slice(i + 1, colEnd - 1);
      explicitCols = splitIdentList(colList);
      i = skipWs(text, colEnd);
    }

    if (!matchKeyword(text, i, "AS")) break;
    i = skipWs(text, i + 2);
    if (text[i] !== "(") break;

    const bodyStart = i + 1;
    const bodyEndExclusive = skipBalancedParen(text, i) - 1;
    const body = text.slice(bodyStart, bodyEndExclusive);
    const columns =
      explicitCols && explicitCols.length > 0
        ? explicitCols
        : inferSelectListColumns(body);

    ctes.push({
      name: nameTok.value,
      columns,
      bodyStart,
      bodyEnd: bodyEndExclusive,
    });

    i = skipWs(text, bodyEndExclusive + 1);
    if (text[i] === ",") {
      i = skipWs(text, i + 1);
      continue;
    }
    break;
  }

  return ctes;
}

/**
 * Relations + CTEs visible at the cursor, using the innermost SELECT scope
 * so nested subqueries do not leak outer FROM tables.
 */
export function parseSqlQueryScope(
  statement: string,
  cursorOffset: number,
): SqlQueryScope {
  const text = maskSqlStrings(stripSqlComments(statement));
  const clamped = Math.max(0, Math.min(cursorOffset, text.length));
  const ctes = parseSqlCtes(text);
  const visibleCtes = visibleCtesAt(ctes, clamped);
  const scope = findInnermostSelectScope(text, clamped);
  const scopeText = text.slice(scope.start, scope.end);

  let relations = parseSqlRelations(scopeText).map((rel) =>
    attachCteColumns(rel, visibleCtes),
  );

  // Deduplicate aliases while preferring CTE-enriched rows
  relations = dedupeRelations(relations);

  return { ctes, visibleCtes, relations, scopeText };
}

export function findInnermostSelectScope(
  statement: string,
  cursorOffset: number,
): { start: number; end: number } {
  const text = maskSqlStrings(stripSqlComments(statement));
  const offset = Math.max(0, Math.min(cursorOffset, text.length));
  const containing: { start: number; end: number }[] = [];
  const stack: number[] = [];

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "(") {
      stack.push(i);
      continue;
    }
    if (ch === ")" && stack.length > 0) {
      const open = stack.pop()!;
      // Cursor inside this pair (after '(' … at/before ')').
      if (open < offset && offset <= i) {
        containing.push({ start: open + 1, end: i });
      }
    }
  }

  // Unclosed "(" … cursor (common while typing a subquery).
  for (const open of stack) {
    if (open < offset) {
      containing.push({ start: open + 1, end: text.length });
    }
  }

  for (let i = containing.length - 1; i >= 0; i -= 1) {
    const range = containing[i]!;
    const slice = text.slice(range.start, range.end);
    if (/\bSELECT\b/i.test(slice)) {
      return range;
    }
  }

  return { start: 0, end: text.length };
}

function visibleCtesAt(ctes: SqlCteDef[], cursorOffset: number): SqlCteDef[] {
  const inBody = ctes.findIndex(
    (cte) => cursorOffset >= cte.bodyStart && cursorOffset <= cte.bodyEnd,
  );
  if (inBody >= 0) {
    return ctes.slice(0, inBody);
  }
  return ctes;
}

function attachCteColumns(
  relation: SqlRelationRef,
  ctes: SqlCteDef[],
): SqlRelationRef {
  if (relation.columns && relation.columns.length > 0) {
    return relation;
  }
  if (relation.schema) {
    return relation;
  }
  const cte = ctes.find(
    (item) => item.name.toLowerCase() === relation.table.toLowerCase(),
  );
  if (!cte || cte.columns.length === 0) {
    return relation;
  }
  return { ...relation, columns: cte.columns };
}

function dedupeRelations(relations: SqlRelationRef[]): SqlRelationRef[] {
  const seen = new Set<string>();
  const result: SqlRelationRef[] = [];
  for (const rel of relations) {
    const key = rel.alias.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(rel);
  }
  return result;
}

function isMainQueryStart(name: string): boolean {
  return ["SELECT", "INSERT", "UPDATE", "DELETE", "MERGE"].includes(
    name.toUpperCase(),
  );
}

function splitIdentList(list: string): string[] {
  return list
    .split(",")
    .map((part) => {
      const trimmed = part.trim();
      const match = trimmed.match(IDENT_RE);
      return match ? unquoteIdent(match[0]) : "";
    })
    .filter(Boolean);
}

function skipWs(text: string, i: number): number {
  while (i < text.length && /\s/.test(text[i]!)) i += 1;
  return i;
}

function readIdent(
  text: string,
  i: number,
): { value: string; end: number } | null {
  const match = text.slice(i).match(IDENT_RE);
  if (!match) return null;
  return { value: unquoteIdent(match[0]), end: i + match[0].length };
}

function matchKeyword(text: string, i: number, keyword: string): boolean {
  const slice = text.slice(i, i + keyword.length);
  if (slice.toUpperCase() !== keyword.toUpperCase()) return false;
  const next = text[i + keyword.length];
  return next === undefined || !/[\w$]/u.test(next);
}

function unquoteIdent(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("[") && value.endsWith("]"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function skipBalancedParen(text: string, i: number): number {
  if (text[i] !== "(") return i;
  let depth = 0;
  for (let p = i; p < text.length; p += 1) {
    const ch = text[p];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return p + 1;
    }
  }
  return text.length;
}
