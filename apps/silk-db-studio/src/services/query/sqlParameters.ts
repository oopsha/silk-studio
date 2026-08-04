export type SqlParameterKind = "named" | "anonymous";

export type SqlParameterOccurrence = {
  kind: SqlParameterKind;
  /** Named: parameter name without prefix. Anonymous: 1-based index among anonymous marks. */
  key: string;
  /** Display label shown in the dialog (`:biz` or `?1`). */
  label: string;
  /** Start index in the original SQL (inclusive). */
  start: number;
  /** End index in the original SQL (exclusive). */
  end: number;
};

export type SqlParameterField = {
  kind: SqlParameterKind;
  key: string;
  label: string;
};

export type SqlParameterDetectOptions = {
  anonymousEnabled: boolean;
  namedEnabled: boolean;
  /** Default `?`. */
  anonymousMark?: string;
  /** Default `:`. */
  namedPrefix?: string;
};

export type SqlParameterValue = {
  /** When true, bind SQL NULL. */
  isNull: boolean;
  value: string;
};

export type BoundSql = {
  /** SQL with placeholders rewritten to JDBC `?`. */
  sql: string;
  /** Positional bind values matching each `?` (null = SQL NULL). */
  binds: Array<string | null>;
};

const DEFAULT_ANONYMOUS_MARK = "?";
const DEFAULT_NAMED_PREFIX = ":";

/**
 * Finds SQL bind placeholders outside strings and comments.
 * Named skips PostgreSQL `::` casts; `:=` is not matched because `=` is not an identifier char.
 */
export function detectSqlParameterOccurrences(
  sql: string,
  options: SqlParameterDetectOptions,
): SqlParameterOccurrence[] {
  const anonymousMark = options.anonymousMark ?? DEFAULT_ANONYMOUS_MARK;
  const namedPrefix = options.namedPrefix ?? DEFAULT_NAMED_PREFIX;
  if (!options.anonymousEnabled && !options.namedEnabled) {
    return [];
  }
  if (!sql) return [];

  const occurrences: SqlParameterOccurrence[] = [];
  let anonymousIndex = 0;
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i];

    if (ch === "'" || ch === '"') {
      i = skipQuoted(sql, i, ch);
      continue;
    }

    if (ch === "-" && sql[i + 1] === "-") {
      i = skipLineComment(sql, i);
      continue;
    }

    if (ch === "/" && sql[i + 1] === "*") {
      i = skipBlockComment(sql, i);
      continue;
    }

    if (
      options.anonymousEnabled &&
      anonymousMark.length > 0 &&
      sql.startsWith(anonymousMark, i)
    ) {
      anonymousIndex += 1;
      const end = i + anonymousMark.length;
      occurrences.push({
        kind: "anonymous",
        key: String(anonymousIndex),
        label: `${anonymousMark}${anonymousIndex}`,
        start: i,
        end,
      });
      i = end;
      continue;
    }

    if (
      options.namedEnabled &&
      namedPrefix.length > 0 &&
      sql.startsWith(namedPrefix, i)
    ) {
      // PostgreSQL cast `::type`
      if (namedPrefix === ":" && sql[i + 1] === ":") {
        i += 2;
        continue;
      }

      const nameStart = i + namedPrefix.length;
      const name = readParameterName(sql, nameStart);
      if (name) {
        const end = nameStart + name.length;
        occurrences.push({
          kind: "named",
          key: name,
          label: `${namedPrefix}${name}`,
          start: i,
          end,
        });
        i = end;
        continue;
      }
    }

    i += 1;
  }

  return occurrences;
}

/** Unique fields for the input dialog (named once; each anonymous separately). */
export function collectSqlParameterFields(
  occurrences: SqlParameterOccurrence[],
): SqlParameterField[] {
  const fields: SqlParameterField[] = [];
  const seenNamed = new Set<string>();

  for (const occurrence of occurrences) {
    if (occurrence.kind === "named") {
      const id = `named:${occurrence.key.toLowerCase()}`;
      if (seenNamed.has(id)) continue;
      seenNamed.add(id);
    }
    fields.push({
      kind: occurrence.kind,
      key: occurrence.key,
      label: occurrence.label,
    });
  }

  return fields;
}

export function detectSqlParameterFields(
  sql: string,
  options: SqlParameterDetectOptions,
): SqlParameterField[] {
  return collectSqlParameterFields(
    detectSqlParameterOccurrences(sql, options),
  );
}

/**
 * Rewrites detected placeholders to `?` and builds a positional bind list.
 * Named values are looked up case-insensitively.
 */
export function bindSqlParameters(
  sql: string,
  occurrences: SqlParameterOccurrence[],
  values: ReadonlyMap<string, SqlParameterValue>,
): BoundSql {
  if (occurrences.length === 0) {
    return { sql, binds: [] };
  }

  let result = "";
  let cursor = 0;
  const binds: Array<string | null> = [];

  for (const occurrence of occurrences) {
    result += sql.slice(cursor, occurrence.start);
    result += "?";
    const mapKey = parameterValueKey(occurrence.kind, occurrence.key);
    const entry = values.get(mapKey);
    if (!entry || entry.isNull) {
      binds.push(null);
    } else {
      binds.push(entry.value);
    }
    cursor = occurrence.end;
  }

  result += sql.slice(cursor);
  return { sql: result, binds };
}

export function parameterValueKey(
  kind: SqlParameterKind,
  key: string,
): string {
  return kind === "named" ? `named:${key.toLowerCase()}` : `anonymous:${key}`;
}

function readParameterName(sql: string, start: number): string | null {
  if (start >= sql.length) return null;
  const first = sql[start];
  if (!/[A-Za-z_\u0080-\uFFFF]/.test(first)) {
    return null;
  }
  let end = start + 1;
  while (end < sql.length && /[A-Za-z0-9_$#\u0080-\uFFFF]/.test(sql[end])) {
    end += 1;
  }
  return sql.slice(start, end);
}

function skipQuoted(sql: string, start: number, quote: "'" | '"'): number {
  let i = start + 1;
  while (i < sql.length) {
    if (sql[i] === quote) {
      // SQL escaped quote: '' or ""
      if (sql[i + 1] === quote) {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i += 1;
  }
  return sql.length;
}

function skipLineComment(sql: string, start: number): number {
  let i = start + 2;
  while (i < sql.length && sql[i] !== "\n") {
    i += 1;
  }
  return i;
}

function skipBlockComment(sql: string, start: number): number {
  let i = start + 2;
  while (i < sql.length) {
    if (sql[i] === "*" && sql[i + 1] === "/") {
      return i + 2;
    }
    i += 1;
  }
  return sql.length;
}
