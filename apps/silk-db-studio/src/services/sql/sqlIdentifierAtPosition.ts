import type { editor, IPosition } from "monaco-editor";

export type ResolvedIdentifier = {
  qualifier: string | null;
  name: string;
};

/**
 * Resolves the identifier under the cursor, including a `schema.object` qualifier
 * if present. Monaco's default word boundary excludes `.`, so `schema.table` always
 * splits into two separate words — this peeks at the character immediately before
 * and after the word under the cursor and, if it's a `.`, resolves the neighboring
 * word on the other side to reassemble the qualified name.
 */
export function resolveIdentifierAtPosition(
  model: editor.ITextModel,
  position: IPosition,
): ResolvedIdentifier | null {
  const word = model.getWordAtPosition(position);
  if (!word) return null;

  const line = position.lineNumber;

  const charBefore = model.getValueInRange({
    startLineNumber: line,
    startColumn: Math.max(1, word.startColumn - 1),
    endLineNumber: line,
    endColumn: word.startColumn,
  });
  if (charBefore === ".") {
    const qualifierWord = model.getWordAtPosition({
      lineNumber: line,
      column: word.startColumn - 1,
    });
    if (qualifierWord) {
      return { qualifier: qualifierWord.word, name: word.word };
    }
  }

  const charAfter = model.getValueInRange({
    startLineNumber: line,
    startColumn: word.endColumn,
    endLineNumber: line,
    endColumn: word.endColumn + 1,
  });
  if (charAfter === ".") {
    const nextWord = model.getWordAtPosition({
      lineNumber: line,
      column: word.endColumn + 1,
    });
    if (nextWord) {
      return { qualifier: word.word, name: nextWord.word };
    }
  }

  return { qualifier: null, name: word.word };
}
