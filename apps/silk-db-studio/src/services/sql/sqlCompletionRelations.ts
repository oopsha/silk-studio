import {
  maskSqlStrings,
  stripSqlComments,
} from "./sqlCompletionClause";
import { inferSelectListColumns } from "./sqlCompletionSelectList";

/**
 * A table/view/CTE/derived reference from FROM / JOIN / UPDATE / INSERT INTO.
 * `alias` is the name used in `alias.column` (defaults to table name when omitted).
 * When `columns` is set (CTE / derived), JDBC is not used for that relation.
 */
export type SqlRelationRef = {
  schema?: string;
  table: string;
  alias: string;
  columns?: string[];
};

const IDENT_RE =
  /^(?:[A-Za-z_\u0080-\uFFFF][\w\u0080-\uFFFF$]*|"[^"]+"|\[[^\]]+\])/;

/** Words that end a relation list or cannot be an alias. */
const RELATION_STOP = new Set(
  [
    "ON",
    "WHERE",
    "GROUP",
    "ORDER",
    "HAVING",
    "UNION",
    "INTERSECT",
    "EXCEPT",
    "LIMIT",
    "OFFSET",
    "FETCH",
    "SET",
    "VALUES",
    "RETURNING",
    "INTO",
    "SELECT",
    "WITH",
    "JOIN",
    "LEFT",
    "RIGHT",
    "INNER",
    "OUTER",
    "FULL",
    "CROSS",
    "APPLY",
    "PIVOT",
    "UNPIVOT",
    "START", // CONNECT BY
    "CONNECT",
    "USING",
    "WHEN", // MERGE
    "MATCHED",
    "AND", // rare after alias; ON a=b AND …
    "OR",
    "GO",
    "ASC",
    "DESC",
    "NULLS",
  ].map((w) => w.toUpperCase()),
);

const RELATION_LEAD =
  /\b(?:FROM|(?:(?:LEFT|RIGHT|FULL|INNER|CROSS|OUTER)\s+)*(?:OUTER\s+)?JOIN|UPDATE|INTO)\b/gi;

/**
 * Parse FROM / JOIN / UPDATE / INTO table references in the given SQL fragment.
 * Parenthesized derived tables become relations with inferred SELECT columns.
 */
export function parseSqlRelations(statement: string): SqlRelationRef[] {
  const text = maskSqlStrings(stripSqlComments(statement));
  const relations: SqlRelationRef[] = [];
  const seenAlias = new Set<string>();

  RELATION_LEAD.lastIndex = 0;
  let lead: RegExpExecArray | null;
  while ((lead = RELATION_LEAD.exec(text)) !== null) {
    // Ignore FROM/JOIN nested inside CTE bodies / subqueries / derived tables.
    if (parenDepthAt(text, lead.index) !== 0) {
      continue;
    }
    const keyword = lead[0].replace(/\s+/g, " ").toUpperCase();
    let i = lead.index + lead[0].length;
    // FROM allows comma-separated list; JOIN / UPDATE / INTO take one relation each.
    const allowCommaList = keyword === "FROM";
    const maxRefs = allowCommaList ? Number.POSITIVE_INFINITY : 1;

    let refs = 0;
    while (refs < maxRefs) {
      i = skipWs(text, i);
      if (i >= text.length) break;

      if (isStopAt(text, i)) break;

      // Derived table: ( … ) [AS] alias
      if (text[i] === "(") {
        const bodyStart = i + 1;
        const afterParen = skipBalancedParen(text, i);
        const body = text.slice(bodyStart, afterParen - 1);
        i = skipWs(text, afterParen);
        if (matchKeyword(text, i, "AS")) {
          i = skipWs(text, i + 2);
        }
        const aliasTok = readIdent(text, i);
        if (aliasTok && !RELATION_STOP.has(aliasTok.value.toUpperCase())) {
          const alias = aliasTok.value;
          i = aliasTok.end;
          const columns = inferSelectListColumns(body);
          const key = alias.toLowerCase();
          if (!seenAlias.has(key)) {
            seenAlias.add(key);
            relations.push({
              table: alias,
              alias,
              ...(columns.length > 0 ? { columns } : {}),
            });
          }
          refs += 1;
          i = skipWs(text, i);
          if (allowCommaList && text[i] === ",") {
            i += 1;
            continue;
          }
        }
        break;
      }

      const first = readIdent(text, i);
      if (!first) break;
      if (RELATION_STOP.has(first.value.toUpperCase())) break;
      i = first.end;

      let schema: string | undefined;
      let table = first.value;

      i = skipWs(text, i);
      if (text[i] === ".") {
        i = skipWs(text, i + 1);
        const second = readIdent(text, i);
        if (!second) break;
        schema = first.value;
        table = second.value;
        i = second.end;
        i = skipWs(text, i);
      }

      let alias = table;
      if (matchKeyword(text, i, "AS")) {
        i = skipWs(text, i + 2);
        const aliasTok = readIdent(text, i);
        if (aliasTok && !RELATION_STOP.has(aliasTok.value.toUpperCase())) {
          alias = aliasTok.value;
          i = aliasTok.end;
        }
      } else {
        const aliasTok = readIdent(text, i);
        if (
          aliasTok &&
          !RELATION_STOP.has(aliasTok.value.toUpperCase()) &&
          !isJoinLead(text, aliasTok.start)
        ) {
          alias = aliasTok.value;
          i = aliasTok.end;
        }
      }

      const key = alias.toLowerCase();
      if (!seenAlias.has(key)) {
        seenAlias.add(key);
        relations.push({
          ...(schema ? { schema } : {}),
          table,
          alias,
        });
      }
      refs += 1;

      i = skipWs(text, i);
      if (allowCommaList && text[i] === ",") {
        i += 1;
        continue;
      }
      break;
    }

    // Continue scanning after this lead (avoid overlapping JOIN prefixes)
    RELATION_LEAD.lastIndex = Math.max(RELATION_LEAD.lastIndex, i);
  }

  return relations;
}

/** Resolve `alias` / table name to a relation (case-insensitive). */
export function findRelationByQualifier(
  relations: SqlRelationRef[],
  qualifier: string,
): SqlRelationRef | undefined {
  const needle = qualifier.toLowerCase();
  return (
    relations.find((rel) => rel.alias.toLowerCase() === needle) ??
    relations.find((rel) => rel.table.toLowerCase() === needle)
  );
}

function skipWs(text: string, i: number): number {
  while (i < text.length && /\s/.test(text[i]!)) i += 1;
  return i;
}

function readIdent(
  text: string,
  i: number,
): { value: string; start: number; end: number } | null {
  const slice = text.slice(i);
  const match = slice.match(IDENT_RE);
  if (!match) return null;
  return {
    value: unquoteIdent(match[0]),
    start: i,
    end: i + match[0].length,
  };
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

function matchKeyword(text: string, i: number, keyword: string): boolean {
  const slice = text.slice(i, i + keyword.length);
  if (slice.toUpperCase() !== keyword.toUpperCase()) return false;
  const next = text[i + keyword.length];
  return next === undefined || !/[\w$]/.test(next);
}

function isStopAt(text: string, i: number): boolean {
  const ident = readIdent(text, i);
  if (!ident) return false;
  return RELATION_STOP.has(ident.value.toUpperCase());
}

/** True if `LEFT`/`INNER`/… starts a JOIN (not an alias). */
function isJoinLead(text: string, i: number): boolean {
  return /^(?:(?:LEFT|RIGHT|FULL|INNER|CROSS|OUTER)\s+)+JOIN\b/i.test(
    text.slice(i),
  );
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

function parenDepthAt(text: string, index: number): number {
  let depth = 0;
  for (let i = 0; i < index; i += 1) {
    const ch = text[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") depth = Math.max(0, depth - 1);
  }
  return depth;
}
