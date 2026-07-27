/**
 * Extracts the SQL to run from an editor buffer: non-empty selection wins; otherwise the
 * statement owned by the cursor (semicolon-terminated, DBeaver-style gap ownership —
 * whitespace after `;` belongs to the previous statement).
 */

export type SqlExtractMode = "selection" | "statement";

export type ExtractExecutableSqlResult = {
  sql: string;
  mode: SqlExtractMode;
  /** Inclusive-exclusive offsets into `content` for the trimmed SQL body (no trailing `;`). */
  range: { start: number; end: number };
};

export function extractExecutableSql(
  content: string,
  selectionStart: number,
  selectionEnd: number,
): ExtractExecutableSqlResult {
  const start = clamp(Math.min(selectionStart, selectionEnd), 0, content.length);
  const end = clamp(Math.max(selectionStart, selectionEnd), 0, content.length);

  if (end > start) {
    const trimmed = trimSqlRange(content, start, end);
    if (trimmed.sql.length > 0) {
      return { sql: trimmed.sql, mode: "selection", range: trimmed.range };
    }
  }

  const statement = findStatementRange(content, start);
  const trimmed = trimSqlRange(content, statement.start, statement.end);
  return {
    sql: trimmed.sql,
    mode: "statement",
    range: trimmed.range,
  };
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

/**
 * Splits SQL into statement ranges by `;`, skipping delimiters inside quotes or comments.
 * Ranges exclude the trailing semicolon. Leading whitespace after a `;` is still stored on
 * the *next* range for splitting simplicity; {@link findStatementRange} assigns that gap to
 * the previous statement for cursor ownership (DBeaver-style).
 */
export function splitSqlStatements(content: string): StatementRange[] {
  const ranges: StatementRange[] = [];
  let statementStart = 0;
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;

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

    if (ch === ";") {
      const body = content.slice(statementStart, i);
      if (body.trim().length > 0) {
        ranges.push({ start: statementStart, end: i });
      }
      statementStart = i + 1;
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

/** JDBC drivers generally reject a trailing statement terminator `;`. */
export function stripTrailingSemicolon(sql: string): string {
  return sql.replace(/;\s*$/, "").trimEnd();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
