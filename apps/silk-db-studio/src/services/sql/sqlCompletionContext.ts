export type SqlCompletionContext = {
  /** Identifiers before the current partial word, split on `.` (e.g. schema, or schema+table). */
  qualifiers: string[];
  /** Word currently being typed (may be empty right after `.`). */
  partial: string;
};

const IDENT = String.raw`[A-Za-z_\u0080-\uFFFF][\w\u0080-\uFFFF$]*|"[^"]+"|\[[^\]]+\]`;

/**
 * Parses the token just before the cursor for dotted SQL completion.
 * Examples (cursor at `|`):
 * - `FROM |` → qualifiers=[], partial=""
 * - `FROM emp|` → qualifiers=[], partial="emp"
 * - `FROM hr.|` → qualifiers=["hr"], partial=""
 * - `FROM hr.emp|` → qualifiers=["hr"], partial="emp"
 * - `hr.employees.|` → qualifiers=["hr","employees"], partial=""
 */
export function parseSqlCompletionContext(linePrefix: string): SqlCompletionContext {
  const match = linePrefix.match(
    new RegExp(`(?:(${IDENT})\\s*\\.\\s*)*(${IDENT})?$`, "u"),
  );
  if (!match) {
    return { qualifiers: [], partial: "" };
  }

  const full = match[0] ?? "";
  if (!full.trim()) {
    return { qualifiers: [], partial: "" };
  }

  const parts = full.split(/\s*\.\s*/).map((part) => unquoteIdent(part.trim()));
  if (full.endsWith(".")) {
    return { qualifiers: parts.filter(Boolean), partial: "" };
  }

  const partial = parts.pop() ?? "";
  return {
    qualifiers: parts.filter(Boolean),
    partial,
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
