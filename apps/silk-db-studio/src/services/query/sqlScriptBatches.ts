import type { ConnectionDriverId } from "../connection/connectionTypes";
import {
  statementsInRange,
  type ExecutableStatement,
} from "./sqlExecutable";

export type ExtractExecutableScriptResult = {
  /** Units to send to the server (GO batches or `;`-separated statements). */
  statements: ExecutableStatement[];
  mode: "selection" | "script";
  /** True when SQL Server `GO` separators were used. */
  usedGo: boolean;
};

/**
 * Script execute range: non-empty selection wins; otherwise the whole buffer
 * (DBeaver Execute Script).
 */
export function scriptSourceRange(
  content: string,
  selectionStart: number,
  selectionEnd: number,
): { start: number; end: number; mode: "selection" | "script" } {
  const start = clamp(Math.min(selectionStart, selectionEnd), 0, content.length);
  const end = clamp(Math.max(selectionStart, selectionEnd), 0, content.length);
  if (end > start) {
    return { start, end, mode: "selection" };
  }
  return { start: 0, end: content.length, mode: "script" };
}

/**
 * Units for Execute Script (`Ctrl+Shift+Enter`):
 * - SQL Server: split on client `GO` batch separators (do not further split by `;`)
 * - other drivers: `;`-separated statements (same splitter as Run Statement selection)
 */
export function extractExecutableScript(
  content: string,
  selectionStart: number,
  selectionEnd: number,
  driverId: ConnectionDriverId | null | undefined,
): ExtractExecutableScriptResult {
  const { start, end, mode } = scriptSourceRange(
    content,
    selectionStart,
    selectionEnd,
  );
  if (end <= start) {
    return { statements: [], mode, usedGo: false };
  }

  if (driverId === "sqlserver") {
    const separators = findGoSeparatorRanges(content, start, end);
    const batches = goBatchesFromSeparators(content, start, end, separators);
    return {
      statements: batches,
      mode,
      usedGo: separators.length > 0,
    };
  }

  return {
    statements: statementsInRange(content, start, end),
    mode,
    usedGo: false,
  };
}

/**
 * Split `[rangeStart, rangeEnd)` on SSMS/sqlcmd-style `GO` lines.
 * A separator is a line whose only token is `GO` (optional repeat count),
 * case-insensitive, not inside quotes or comments.
 */
export function goBatchesInRange(
  content: string,
  rangeStart: number,
  rangeEnd: number,
): ExecutableStatement[] {
  const start = clamp(rangeStart, 0, content.length);
  const end = clamp(rangeEnd, 0, content.length);
  if (end <= start) return [];
  const separators = findGoSeparatorRanges(content, start, end);
  return goBatchesFromSeparators(content, start, end, separators);
}

function goBatchesFromSeparators(
  content: string,
  start: number,
  end: number,
  separators: OffsetRange[],
): ExecutableStatement[] {
  if (separators.length === 0) {
    const trimmed = trimBatch(content, start, end);
    return trimmed ? [trimmed] : [];
  }

  const batches: ExecutableStatement[] = [];
  let batchStart = start;
  for (const sep of separators) {
    const trimmed = trimBatch(content, batchStart, sep.start);
    if (trimmed) batches.push(trimmed);
    batchStart = sep.end;
  }
  const trailing = trimBatch(content, batchStart, end);
  if (trailing) batches.push(trailing);
  return batches;
}

type OffsetRange = { start: number; end: number };

/**
 * Returns absolute `[start, end)` ranges covering each `GO` separator line
 * (from line start through end of GO token / optional count, excluding the
 * trailing newline).
 */
export function findGoSeparatorRanges(
  content: string,
  rangeStart: number,
  rangeEnd: number,
): OffsetRange[] {
  const start = clamp(rangeStart, 0, content.length);
  const end = clamp(rangeEnd, 0, content.length);
  const found: OffsetRange[] = [];

  let i = start;
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;
  /** Absolute offset of the current line's first character within the range. */
  let lineStart = start;

  while (i < end) {
    const ch = content[i];
    const next = i + 1 < end ? content[i + 1] : "";

    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false;
        lineStart = i + 1;
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
      if (ch === "\n") {
        lineStart = i + 1;
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
      if (ch === "\n") {
        lineStart = i + 1;
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
      if (ch === "\n") {
        lineStart = i + 1;
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

    if (ch === "\r") {
      i += 1;
      if (i < end && content[i] === "\n") {
        lineStart = i + 1;
        i += 1;
      } else {
        lineStart = i;
      }
      continue;
    }

    if (ch === "\n") {
      lineStart = i + 1;
      i += 1;
      continue;
    }

    // First non-whitespace on this line: try GO.
    if (i === lineStart || isOnlyWhitespace(content, lineStart, i)) {
      let j = i;
      while (j < end && (content[j] === " " || content[j] === "\t")) {
        j += 1;
      }
      const afterGo = matchGoSeparator(content, j, end);
      if (afterGo !== null && j === firstNonWhitespace(content, lineStart, end)) {
        // Include leading whitespace of the line in the separator span.
        let sepEnd = afterGo;
        // Consume trailing spaces before newline into separator end (still before NL).
        while (
          sepEnd < end &&
          (content[sepEnd] === " " || content[sepEnd] === "\t")
        ) {
          sepEnd += 1;
        }
        found.push({ start: lineStart, end: sepEnd });
        i = sepEnd;
        continue;
      }
    }

    i += 1;
  }

  return found;
}

function isOnlyWhitespace(content: string, start: number, end: number): boolean {
  for (let i = start; i < end; i += 1) {
    if (content[i] !== " " && content[i] !== "\t") return false;
  }
  return true;
}

function firstNonWhitespace(
  content: string,
  start: number,
  end: number,
): number {
  let i = start;
  while (i < end && (content[i] === " " || content[i] === "\t")) {
    i += 1;
  }
  return i;
}

/**
 * If `content[index…]` starts a GO separator token, returns the offset just past
 * `GO` and optional count (before trailing whitespace/newline). Otherwise null.
 */
function matchGoSeparator(
  content: string,
  index: number,
  end: number,
): number | null {
  if (index + 2 > end) return null;
  const c0 = content[index];
  const c1 = content[index + 1];
  if ((c0 !== "G" && c0 !== "g") || (c1 !== "O" && c1 !== "o")) {
    return null;
  }
  let i = index + 2;
  if (i < end && isIdentChar(content[i])) {
    return null;
  }
  while (i < end && (content[i] === " " || content[i] === "\t")) {
    i += 1;
  }
  if (i < end && content[i] >= "0" && content[i] <= "9") {
    while (i < end && content[i] >= "0" && content[i] <= "9") {
      i += 1;
    }
  }
  while (i < end && (content[i] === " " || content[i] === "\t")) {
    i += 1;
  }
  if (i >= end || content[i] === "\n" || content[i] === "\r") {
    return i;
  }
  return null;
}

function isIdentChar(ch: string): boolean {
  return (
    (ch >= "A" && ch <= "Z") ||
    (ch >= "a" && ch <= "z") ||
    (ch >= "0" && ch <= "9") ||
    ch === "_" ||
    ch === "#" ||
    ch === "@" ||
    ch === "$"
  );
}

function trimBatch(
  content: string,
  sliceStart: number,
  sliceEnd: number,
): ExecutableStatement | null {
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
  if (end <= start) return null;
  return {
    sql: content.slice(start, end),
    range: { start, end },
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
