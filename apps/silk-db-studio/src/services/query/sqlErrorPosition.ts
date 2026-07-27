/**
 * Best-effort parse of JDBC / driver error text into a position relative to the
 * executed statement (not the full editor buffer).
 */

export type SqlErrorPosition =
  | { kind: "offset"; /** 0-based character offset within the statement */ offset: number }
  | {
      kind: "lineColumn";
      /** 1-based line within the statement */
      line: number;
      /** 1-based column within that line */
      column: number;
    }
  | { kind: "line"; /** 1-based line within the statement */ line: number };

export function parseSqlErrorPosition(message: string): SqlErrorPosition | null {
  if (!message.trim()) return null;

  // PostgreSQL / some JDBC: "Position: 42" (1-based in the query string).
  const pgPosition = /\bPosition:\s*(\d+)\b/i.exec(message);
  if (pgPosition) {
    const oneBased = Number(pgPosition[1]);
    if (Number.isFinite(oneBased) && oneBased > 0) {
      return { kind: "offset", offset: oneBased - 1 };
    }
  }

  // Oracle SQL*Plus / some clients: "Error at line 1, column 15" / "at line 2 column 3".
  const lineColumn =
    /(?:error\s+)?at\s+line\s+(\d+)\s*,?\s*column\s+(\d+)/i.exec(message) ??
    /\bline\s+(\d+)\s*,\s*column\s+(\d+)\b/i.exec(message);
  if (lineColumn) {
    const line = Number(lineColumn[1]);
    const column = Number(lineColumn[2]);
    if (Number.isFinite(line) && line > 0 && Number.isFinite(column) && column > 0) {
      return { kind: "lineColumn", line, column };
    }
  }

  // MySQL / MariaDB: "... near 'FOO' at line 1"
  const mysqlLine = /\bat line\s+(\d+)\b/i.exec(message);
  if (mysqlLine) {
    const line = Number(mysqlLine[1]);
    if (Number.isFinite(line) && line > 0) {
      return { kind: "line", line };
    }
  }

  // SQL Server: "Line 12" or "Msg ..., Level ..., State ..., Line 3"
  const sqlServerLine = /\bLine\s+(\d+)\b/.exec(message);
  if (sqlServerLine) {
    const line = Number(sqlServerLine[1]);
    if (Number.isFinite(line) && line > 0) {
      return { kind: "line", line };
    }
  }

  return null;
}

/** Maps a statement-relative position to a 0-based offset within `statement`. */
export function positionToOffset(
  statement: string,
  position: SqlErrorPosition,
): number {
  if (position.kind === "offset") {
    return clamp(position.offset, 0, Math.max(0, statement.length));
  }

  const line = position.kind === "line" ? position.line : position.line;
  const column = position.kind === "lineColumn" ? position.column : 1;
  return lineColumnToOffset(statement, line, column);
}

export function lineColumnToOffset(
  text: string,
  line: number,
  column: number,
): number {
  const targetLine = Math.max(1, Math.floor(line));
  const targetColumn = Math.max(1, Math.floor(column));
  let currentLine = 1;
  let index = 0;

  while (index < text.length && currentLine < targetLine) {
    if (text[index] === "\n") {
      currentLine += 1;
    }
    index += 1;
  }

  if (currentLine !== targetLine) {
    return text.length;
  }

  const lineStart = index;
  let lineEnd = lineStart;
  while (lineEnd < text.length && text[lineEnd] !== "\n") {
    lineEnd += 1;
  }

  const offsetInLine = Math.min(targetColumn - 1, Math.max(0, lineEnd - lineStart));
  return lineStart + offsetInLine;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
