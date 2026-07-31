import {
  maskSqlStrings,
  stripSqlComments,
} from "./sqlCompletionClause";

const IDENT_RE =
  /^(?:[A-Za-z_\u0080-\uFFFF][\w\u0080-\uFFFF$]*|"[^"]+"|\[[^\]]+\])/;

const SELECT_LIST_END = new Set(
  [
    "FROM",
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
    "FOR",
    "WINDOW",
    "INTO",
  ].map((w) => w.toUpperCase()),
);

/**
 * Infer output column names from a SELECT list (CTE body / derived table).
 * Uses AS alias, trailing alias, or simple column references — skips `*`.
 */
export function inferSelectListColumns(fragment: string): string[] {
  const text = maskSqlStrings(stripSqlComments(fragment));
  const selectPos = findTopLevelKeyword(text, "SELECT", 0);
  if (selectPos < 0) return [];

  let i = skipWs(text, selectPos + "SELECT".length);
  if (matchKeyword(text, i, "DISTINCT") || matchKeyword(text, i, "ALL")) {
    const tok = readIdent(text, i);
    i = skipWs(text, tok ? tok.end : i);
  }

  const end = findSelectListEnd(text, i);
  const items = splitTopLevel(text.slice(i, end), ",");
  const columns: string[] = [];
  const seen = new Set<string>();

  for (const raw of items) {
    const item = raw.trim();
    if (!item) continue;
    const name = columnNameFromSelectItem(item);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    columns.push(name);
  }
  return columns;
}

function columnNameFromSelectItem(item: string): string | null {
  if (item === "*" || /\.\*$/.test(item)) return null;

  const asMatch = item.match(
    /\bAS\s+("([^"]+)"|\[[^\]]+\]|[A-Za-z_\u0080-\uFFFF][\w\u0080-\uFFFF$]*)\s*$/iu,
  );
  if (asMatch?.[1]) {
    return unquoteIdent(asMatch[1]);
  }

  // Simple reference: [schema.]column
  const simple = item.match(
    /^(?:("([^"]+)"|\[[^\]]+\]|[A-Za-z_\u0080-\uFFFF][\w\u0080-\uFFFF$]*)\s*\.\s*)?("([^"]+)"|\[[^\]]+\]|[A-Za-z_\u0080-\uFFFF][\w\u0080-\uFFFF$]*)$/u,
  );
  if (simple?.[3]) {
    return unquoteIdent(simple[3]);
  }

  // Trailing alias: COUNT(*) cnt / expr alias
  const trailing = item.match(
    /\s+("([^"]+)"|\[[^\]]+\]|[A-Za-z_\u0080-\uFFFF][\w\u0080-\uFFFF$]*)\s*$/u,
  );
  if (trailing?.[1]) {
    const name = unquoteIdent(trailing[1]);
    if (!SELECT_LIST_END.has(name.toUpperCase())) {
      return name;
    }
  }

  return null;
}

function findSelectListEnd(text: string, from: number): number {
  let depth = 0;
  for (let i = from; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "(") {
      depth += 1;
      continue;
    }
    if (ch === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth !== 0) continue;
    const ident = readIdent(text, i);
    if (ident && SELECT_LIST_END.has(ident.value.toUpperCase())) {
      return i;
    }
  }
  return text.length;
}

function findTopLevelKeyword(
  text: string,
  keyword: string,
  from: number,
): number {
  let depth = 0;
  for (let i = from; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "(") {
      depth += 1;
      continue;
    }
    if (ch === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0 && matchKeyword(text, i, keyword)) {
      return i;
    }
  }
  return -1;
}

function splitTopLevel(text: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && ch === sep) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
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
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
