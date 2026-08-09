/**
 * Extracts the SQL to run from an editor buffer: non-empty selection wins; otherwise the
 * statement owned by the cursor (semicolon-terminated, DBeaver-style gap ownership —
 * whitespace after `;` belongs to the previous statement).
 */

import { stripSqlComments } from "./sqlTableReference";

export type SqlExtractMode = "selection" | "statement";

export type ExtractExecutableSqlResult = {
  sql: string;
  mode: SqlExtractMode;
  /** Inclusive-exclusive offsets into `content` for the trimmed SQL body (no trailing `;`). */
  range: { start: number; end: number };
};

export type ExecutableStatement = {
  sql: string;
  range: { start: number; end: number };
};

export type ExtractExecutableStatementsResult = {
  statements: ExecutableStatement[];
  mode: SqlExtractMode;
};

export function extractExecutableSql(
  content: string,
  selectionStart: number,
  selectionEnd: number,
): ExtractExecutableSqlResult {
  const { statements, mode } = extractExecutableStatements(
    content,
    selectionStart,
    selectionEnd,
  );
  if (statements.length === 0) {
    return { sql: "", mode, range: { start: 0, end: 0 } };
  }
  if (statements.length === 1) {
    return { sql: statements[0].sql, mode, range: statements[0].range };
  }
  // Legacy single-string extract: join with newlines (prefer extractExecutableStatements).
  const first = statements[0];
  const last = statements[statements.length - 1];
  return {
    sql: statements.map((item) => item.sql).join(";\n"),
    mode,
    range: { start: first.range.start, end: last.range.end },
  };
}

/**
 * Statements to run for Ctrl+Enter:
 * - non-empty selection → every `;`-separated statement inside the selection
 * - otherwise → the single statement owned by the cursor
 */
export function extractExecutableStatements(
  content: string,
  selectionStart: number,
  selectionEnd: number,
): ExtractExecutableStatementsResult {
  const start = clamp(Math.min(selectionStart, selectionEnd), 0, content.length);
  const end = clamp(Math.max(selectionStart, selectionEnd), 0, content.length);

  if (end > start) {
    const statements = statementsInRange(content, start, end);
    if (statements.length > 0) {
      return { statements, mode: "selection" };
    }
  }

  const statement = findStatementRange(content, start);
  const trimmed = trimSqlRange(content, statement.start, statement.end);
  if (!trimmed.sql) {
    return { statements: [], mode: "statement" };
  }
  return {
    statements: [{ sql: trimmed.sql, range: trimmed.range }],
    mode: "statement",
  };
}

/** Split `[rangeStart, rangeEnd)` into trimmed executable statements (absolute offsets). */
export function statementsInRange(
  content: string,
  rangeStart: number,
  rangeEnd: number,
): ExecutableStatement[] {
  const start = clamp(rangeStart, 0, content.length);
  const end = clamp(rangeEnd, 0, content.length);
  if (end <= start) return [];

  const slice = content.slice(start, end);
  const relative = splitSqlStatements(slice);
  const statements: ExecutableStatement[] = [];

  for (const relativeRange of relative) {
    const trimmed = trimSqlRange(
      content,
      start + relativeRange.start,
      start + relativeRange.end,
    );
    if (trimmed.sql.length > 0) {
      statements.push({ sql: trimmed.sql, range: trimmed.range });
    }
  }

  // Selection with no `;` still counts as one statement.
  if (statements.length === 0) {
    const trimmed = trimSqlRange(content, start, end);
    if (trimmed.sql.length > 0) {
      statements.push({ sql: trimmed.sql, range: trimmed.range });
    }
  }

  return statements;
}

/**
 * Trims leading/trailing whitespace and a trailing `;` within `[sliceStart, sliceEnd)`,
 * returning the SQL text and its absolute offsets in `content`.
 */
export function trimSqlRange(
  content: string,
  sliceStart: number,
  sliceEnd: number,
): { sql: string; range: { start: number; end: number } } {
  let start = clamp(sliceStart, 0, content.length);
  let end = clamp(sliceEnd, 0, content.length);
  while (start < end && /\s/.test(content[start])) {
    start += 1;
  }
  while (end > start && /\s/.test(content[end - 1])) {
    end -= 1;
  }
  if (end > start && content[end - 1] === ";") {
    end -= 1;
    while (end > start && /\s/.test(content[end - 1])) {
      end -= 1;
    }
  }
  return { sql: content.slice(start, end), range: { start, end } };
}

/**
 * Inclusive-exclusive range of the statement to run for a cursor `offset`.
 *
 * DBeaver-style ownership: after a statement's `;`, blank lines / whitespace until the next
 * statement's first non-whitespace belong to the *previous* statement — not the next one.
 */
export function findStatementRange(
  content: string,
  offset: number,
): { start: number; end: number } {
  const ranges = splitSqlStatements(content);
  if (ranges.length === 0) {
    return { start: 0, end: content.length };
  }

  const cursor = clamp(offset, 0, content.length);

  for (let index = 0; index < ranges.length; index++) {
    const range = ranges[index];
    const bodyStart = firstNonWhitespaceInRange(content, range.start, range.end);
    const nextBodyStart =
      index + 1 < ranges.length
        ? firstNonWhitespaceInRange(
            content,
            ranges[index + 1].start,
            ranges[index + 1].end,
          )
        : content.length;

    // First statement also owns any leading file whitespace.
    const ownStart = index === 0 ? 0 : bodyStart;
    // Own through this statement's `;` and the following gap (exclusive of next body).
    const ownEnd = nextBodyStart;

    if (cursor >= ownStart && cursor < ownEnd) {
      return range;
    }
  }

  // Trailing whitespace after the last statement (including cursor at EOF).
  return ranges[ranges.length - 1];
}

/** First non-whitespace offset in `[start, end)`, or `end` if the slice is all whitespace. */
function firstNonWhitespaceInRange(
  content: string,
  start: number,
  end: number,
): number {
  let index = start;
  while (index < end && /\s/.test(content[index])) {
    index += 1;
  }
  return index;
}

type StatementRange = { start: number; end: number };

function isWordChar(ch: string): boolean {
  return (
    (ch >= "A" && ch <= "Z") ||
    (ch >= "a" && ch <= "z") ||
    (ch >= "0" && ch <= "9") ||
    ch === "_" ||
    ch === "$" ||
    ch === "#"
  );
}

/** Reads the contiguous word starting at `index` (empty string if `index` isn't a word char). */
function readWordAt(content: string, index: number): string {
  let j = index;
  while (j < content.length && isWordChar(content[j])) {
    j += 1;
  }
  return content.slice(index, j);
}

const PLSQL_BLOCK_INCREMENT = /^(?:begin|case|loop|if)$/i;
const PLSQL_END_TAG = /^(?:if|loop|case)$/i;

/**
 * Splits SQL into statement ranges by `;`, skipping delimiters inside quotes or comments.
 * Ranges exclude the trailing semicolon. Leading whitespace after a `;` is still stored on
 * the *next* range for splitting simplicity; {@link findStatementRange} assigns that gap to
 * the previous statement for cursor ownership (DBeaver-style).
 *
 * An anonymous PL/SQL block (`DECLARE ...` or `BEGIN ...`) is treated as a single statement:
 * `;` inside it is only a real terminator once BEGIN/CASE/IF/LOOP nesting has returned to zero
 * after entering the block's own top-level BEGIN. Without this, e.g. a `DECLARE x VARCHAR2(10);`
 * line would be mistaken for the end of the whole block.
 */
export function splitSqlStatements(content: string): StatementRange[] {
  const ranges: StatementRange[] = [];
  let statementStart = 0;
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;

  let plsqlBlock = false;
  let plsqlDepth = 0;
  let plsqlEnteredBegin = false;
  let statementOpenerChecked = false;

  const resetStatementState = (nextStart: number) => {
    statementStart = nextStart;
    plsqlBlock = false;
    plsqlDepth = 0;
    plsqlEnteredBegin = false;
    statementOpenerChecked = false;
  };

  while (i < content.length) {
    const ch = content[i];
    const next = i + 1 < content.length ? content[i + 1] : "";

    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false;
      }
      i += 1;
      continue;
    }

    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }

    if (inSingle) {
      if (ch === "'" && next === "'") {
        i += 2;
        continue;
      }
      if (ch === "'") {
        inSingle = false;
      }
      i += 1;
      continue;
    }

    if (inDouble) {
      if (ch === '"' && next === '"') {
        i += 2;
        continue;
      }
      if (ch === '"') {
        inDouble = false;
      }
      i += 1;
      continue;
    }

    if (ch === "-" && next === "-") {
      inLineComment = true;
      i += 2;
      continue;
    }

    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i += 2;
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inDouble = true;
      i += 1;
      continue;
    }

    const atWordStart = isWordChar(ch) && (i === 0 || !isWordChar(content[i - 1]));

    // Statement's first token: only DECLARE/BEGIN opens a PL/SQL block; anything else
    // leaves plsqlBlock false and normal per-`;` splitting applies below, unchanged.
    if (atWordStart && !plsqlBlock && !statementOpenerChecked) {
      statementOpenerChecked = true;
      const word = readWordAt(content, i);
      const lower = word.toLowerCase();
      if (lower === "begin") {
        plsqlBlock = true;
        plsqlDepth = 1;
        plsqlEnteredBegin = true;
        i += word.length;
        continue;
      }
      if (lower === "declare") {
        plsqlBlock = true;
        i += word.length;
        continue;
      }
    } else if (atWordStart && plsqlBlock) {
      const word = readWordAt(content, i);
      const lower = word.toLowerCase();
      if (PLSQL_BLOCK_INCREMENT.test(lower)) {
        plsqlDepth += 1;
        plsqlEnteredBegin = true;
        i += word.length;
        continue;
      }
      if (lower === "end") {
        plsqlDepth = Math.max(0, plsqlDepth - 1);
        i += word.length;
        // Consume an optional trailing IF/LOOP/CASE tag as part of the same END marker.
        let j = i;
        while (j < content.length && /\s/.test(content[j])) {
          j += 1;
        }
        const trailing = readWordAt(content, j);
        if (PLSQL_END_TAG.test(trailing)) {
          i = j + trailing.length;
        }
        continue;
      }
      // Any other identifier/keyword: skip the whole word so we never re-test mid-word
      // (a table/column named e.g. `XBEGIN` must not look like the keyword `BEGIN`).
      i += word.length;
      continue;
    }

    if (ch === ";") {
      if (plsqlBlock && !(plsqlEnteredBegin && plsqlDepth === 0)) {
        // Inside an unfinished PL/SQL block — not the statement's real terminator.
        i += 1;
        continue;
      }
      const body = content.slice(statementStart, i);
      if (body.trim().length > 0) {
        ranges.push({ start: statementStart, end: i });
      }
      resetStatementState(i + 1);
      i += 1;
      continue;
    }

    i += 1;
  }

  if (statementStart < content.length) {
    const body = content.slice(statementStart);
    if (body.trim().length > 0) {
      ranges.push({ start: statementStart, end: content.length });
    }
  }

  return ranges;
}

/**
 * JDBC drivers generally reject a trailing statement terminator `;` for plain SQL — but an
 * anonymous PL/SQL block (`DECLARE`/`BEGIN ... END`) requires its own closing `;`; Oracle
 * rejects `END` without one (PLS-00103, "end-of-file" expecting `;`). Keep it for those.
 */
export function stripTrailingSemicolon(sql: string): string {
  const trimmed = sql.trim();
  if (isAnonymousPlsqlBlock(trimmed)) {
    return trimmed.endsWith(";") ? trimmed : `${trimmed};`;
  }
  return trimmed.replace(/;\s*$/, "").trimEnd();
}

function isAnonymousPlsqlBlock(sql: string): boolean {
  return /^\s*(?:declare|begin)\b/i.test(stripSqlComments(sql));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
