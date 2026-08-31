import { splitSqlStatements } from "../query/sqlExecutable";

export type SqlOutlineCategory =
  | "table"
  | "view"
  | "index"
  | "procedure"
  | "function"
  | "package"
  | "trigger"
  | "type"
  | "sequence"
  | "query"
  | "dml"
  | "block"
  | "other";

export type SqlOutlineEntry = {
  id: string;
  start: number;
  end: number;
  /** What's shown in the list — detected object name, or a trimmed summary of the statement. */
  label: string;
  category: SqlOutlineCategory;
  /** Detected object name, when the statement is a CREATE/ALTER/DROP against a named object. */
  name: string | null;
};

const OBJECT_TYPE_TO_CATEGORY: Record<string, SqlOutlineCategory> = {
  TABLE: "table",
  VIEW: "view",
  "MATERIALIZED VIEW": "view",
  INDEX: "index",
  "UNIQUE INDEX": "index",
  PROCEDURE: "procedure",
  FUNCTION: "function",
  PACKAGE: "package",
  "PACKAGE BODY": "package",
  TRIGGER: "trigger",
  TYPE: "type",
  "TYPE BODY": "type",
  SEQUENCE: "sequence",
};

const CREATE_RE =
  /^CREATE\s+(?:OR\s+REPLACE\s+)?(?:GLOBAL\s+TEMPORARY\s+)?(TABLE|MATERIALIZED\s+VIEW|VIEW|UNIQUE\s+INDEX|INDEX|PROCEDURE|FUNCTION|PACKAGE\s+BODY|PACKAGE|TRIGGER|TYPE\s+BODY|TYPE|SEQUENCE)\s+(?:IF\s+NOT\s+EXISTS\s+)?("?[\w$#.]+"?)/i;
const ALTER_RE =
  /^ALTER\s+(TABLE|VIEW|PROCEDURE|FUNCTION|PACKAGE|TRIGGER|TYPE|SEQUENCE|INDEX)\s+("?[\w$#.]+"?)/i;
const DROP_RE =
  /^DROP\s+(TABLE|VIEW|PROCEDURE|FUNCTION|PACKAGE\s+BODY|PACKAGE|TRIGGER|TYPE|SEQUENCE|INDEX)\s+(?:IF\s+EXISTS\s+)?("?[\w$#.]+"?)/i;
const DML_RE = /^(INSERT(?:\s+INTO)?|UPDATE|DELETE(?:\s+FROM)?|MERGE(?:\s+INTO)?|TRUNCATE(?:\s+TABLE)?)\s+("?[\w$#.]+"?)/i;
const QUERY_RE = /^(SELECT|WITH)\b/i;
const BLOCK_RE = /^(BEGIN|DECLARE)\b/i;

function normalizeType(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().toUpperCase();
}

function stripQuotes(name: string): string {
  return name.replace(/^"(.*)"$/, "$1");
}

function classifyStatement(text: string): {
  category: SqlOutlineCategory;
  name: string | null;
} {
  const head = text.trimStart();

  const created = CREATE_RE.exec(head);
  if (created) {
    const type = normalizeType(created[1]);
    return {
      category: OBJECT_TYPE_TO_CATEGORY[type] ?? "other",
      name: stripQuotes(created[2]),
    };
  }

  const altered = ALTER_RE.exec(head);
  if (altered) {
    const type = normalizeType(altered[1]);
    return {
      category: OBJECT_TYPE_TO_CATEGORY[type] ?? "other",
      name: stripQuotes(altered[2]),
    };
  }

  const dropped = DROP_RE.exec(head);
  if (dropped) {
    const type = normalizeType(dropped[1]);
    return {
      category: OBJECT_TYPE_TO_CATEGORY[type] ?? "other",
      name: stripQuotes(dropped[2]),
    };
  }

  const dml = DML_RE.exec(head);
  if (dml) {
    return { category: "dml", name: stripQuotes(dml[2]) };
  }

  if (QUERY_RE.test(head)) {
    return { category: "query", name: null };
  }

  if (BLOCK_RE.test(head)) {
    return { category: "block", name: null };
  }

  return { category: "other", name: null };
}

const CATEGORY_PREFIX: Record<SqlOutlineCategory, string> = {
  table: "TABLE",
  view: "VIEW",
  index: "INDEX",
  procedure: "PROCEDURE",
  function: "FUNCTION",
  package: "PACKAGE",
  trigger: "TRIGGER",
  type: "TYPE",
  sequence: "SEQUENCE",
  query: "SELECT",
  dml: "DML",
  block: "BLOCK",
  other: "SQL",
};

function summarize(text: string): string {
  const singleLine = text.replace(/\s+/g, " ").trim();
  return singleLine.length > 60 ? `${singleLine.slice(0, 60)}…` : singleLine;
}

/** Codicon name per category — used by OutlineView for the row icon. */
export function outlineCategoryIcon(category: SqlOutlineCategory): string {
  switch (category) {
    case "table":
      return "symbol-namespace";
    case "view":
      return "eye";
    case "index":
      return "list-flat";
    case "procedure":
    case "function":
      return "symbol-method";
    case "package":
      return "symbol-class";
    case "trigger":
      return "symbol-event";
    case "type":
      return "symbol-struct";
    case "sequence":
      return "list-ordered";
    case "query":
      return "search";
    case "dml":
      return "edit";
    case "block":
      return "code";
    default:
      return "circle-outline";
  }
}

export function buildSqlOutline(content: string): SqlOutlineEntry[] {
  const ranges = splitSqlStatements(content);
  const entries: SqlOutlineEntry[] = [];

  ranges.forEach((range, index) => {
    const raw = content.slice(range.start, range.end);
    const text = raw.trim();
    if (!text) return;

    // `range.start` is the raw split point right after the previous statement's terminator —
    // it still includes the blank line/whitespace before this statement's actual first
    // character. Jumping there would land the cursor on the wrong line, so trim it in.
    const leadingWhitespace = raw.length - raw.trimStart().length;
    const start = range.start + leadingWhitespace;

    const { category, name } = classifyStatement(text);
    const label = name ? `${CATEGORY_PREFIX[category]} ${name}` : summarize(text);

    entries.push({
      id: `${index}-${start}`,
      start,
      end: range.end,
      label,
      category,
      name,
    });
  });

  return entries;
}
