import type { editor, IPosition } from "monaco-editor";

export type ResolvedIdentifier = {
  /** Leading segment(s) before `qualifier.name`, e.g. the database in SQL Server's `db.schema.table`. */
  database: string | null;
  qualifier: string | null;
  name: string;
};

/**
 * Resolves the identifier under the cursor, including any `qualifier.object` or
 * `database.schema.object` chain. Monaco's default word boundary excludes `.`, so a
 * dotted identifier always splits into separate words — this walks outward from the
 * word under the cursor (both left and right across `.` boundaries) to reassemble the
 * full chain regardless of which segment the cursor happens to be on.
 */
export function resolveIdentifierAtPosition(
  model: editor.ITextModel,
  position: IPosition,
): ResolvedIdentifier | null {
  const word = model.getWordAtPosition(position);
  if (!word) return null;

  const line = position.lineNumber;
  const parts: string[] = [word.word];
  let startColumn = word.startColumn;
  let endColumn = word.endColumn;

  while (true) {
    const before = model.getValueInRange({
      startLineNumber: line,
      startColumn: Math.max(1, startColumn - 1),
      endLineNumber: line,
      endColumn: startColumn,
    });
    if (before !== ".") break;
    const left = model.getWordAtPosition({
      lineNumber: line,
      column: startColumn - 1,
    });
    if (!left) break;
    parts.unshift(left.word);
    startColumn = left.startColumn;
  }

  while (true) {
    const after = model.getValueInRange({
      startLineNumber: line,
      startColumn: endColumn,
      endLineNumber: line,
      endColumn: endColumn + 1,
    });
    if (after !== ".") break;
    const right = model.getWordAtPosition({
      lineNumber: line,
      column: endColumn + 1,
    });
    if (!right) break;
    parts.push(right.word);
    endColumn = right.endColumn;
  }

  if (parts.length === 1) {
    return { database: null, qualifier: null, name: parts[0] };
  }
  if (parts.length === 2) {
    return { database: null, qualifier: parts[0], name: parts[1] };
  }
  return {
    database: parts.slice(0, parts.length - 2).join("."),
    qualifier: parts[parts.length - 2],
    name: parts[parts.length - 1],
  };
}
