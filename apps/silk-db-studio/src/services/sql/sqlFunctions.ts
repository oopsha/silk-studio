import type { ConnectionDriverId } from "../connection/connectionTypes";

export type SqlFunctionParameter = {
  label: string;
  documentation?: string;
};

export type SqlFunctionSignature = {
  label: string;
  parameters: SqlFunctionParameter[];
};

export type SqlFunctionDef = {
  name: string;
  /** Monaco snippet (`InsertAsSnippet`). */
  insertText: string;
  detail: string;
  documentation?: string;
  signatures?: SqlFunctionSignature[];
};

function fn(
  name: string,
  insertText: string,
  detail: string,
  documentation?: string,
  signatures?: SqlFunctionSignature[],
): SqlFunctionDef {
  return { name, insertText, detail, documentation, signatures };
}

function sig(
  label: string,
  ...parameters: SqlFunctionParameter[]
): SqlFunctionSignature {
  return { label, parameters };
}

const COMMON: SqlFunctionDef[] = [
  fn(
    "ABS",
    "ABS(${1:numeric})",
    "function",
    "Absolute value.",
    [sig("ABS(numeric)", { label: "numeric" })],
  ),
  fn(
    "AVG",
    "AVG(${1:expr})",
    "aggregate",
    "Average of non-null values.",
    [sig("AVG(expr)", { label: "expr" })],
  ),
  fn(
    "CAST",
    "CAST(${1:expr} AS ${2:type})",
    "function",
    "Convert a value to another type.",
    [
      sig("CAST(expr AS type)", {
        label: "expr",
      }, { label: "type" }),
    ],
  ),
  fn(
    "COALESCE",
    "COALESCE(${1:expr1}, ${2:expr2})",
    "function",
    "First non-null argument.",
    [
      sig(
        "COALESCE(expr1, expr2, …)",
        { label: "expr1" },
        { label: "expr2" },
      ),
    ],
  ),
  fn(
    "COUNT",
    "COUNT(${1:*})",
    "aggregate",
    "Count rows or non-null values.",
    [sig("COUNT(expr)", { label: "expr" })],
  ),
  fn(
    "LOWER",
    "LOWER(${1:string})",
    "function",
    "Lowercase string.",
    [sig("LOWER(string)", { label: "string" })],
  ),
  fn(
    "UPPER",
    "UPPER(${1:string})",
    "function",
    "Uppercase string.",
    [sig("UPPER(string)", { label: "string" })],
  ),
  fn(
    "LENGTH",
    "LENGTH(${1:string})",
    "function",
    "Character length (dialect may use LEN / CHAR_LENGTH).",
    [sig("LENGTH(string)", { label: "string" })],
  ),
  fn(
    "MAX",
    "MAX(${1:expr})",
    "aggregate",
    "Maximum value.",
    [sig("MAX(expr)", { label: "expr" })],
  ),
  fn(
    "MIN",
    "MIN(${1:expr})",
    "aggregate",
    "Minimum value.",
    [sig("MIN(expr)", { label: "expr" })],
  ),
  fn(
    "NULLIF",
    "NULLIF(${1:expr1}, ${2:expr2})",
    "function",
    "NULL if arguments are equal.",
    [
      sig("NULLIF(expr1, expr2)", {
        label: "expr1",
      }, { label: "expr2" }),
    ],
  ),
  fn(
    "ROUND",
    "ROUND(${1:numeric}, ${2:decimals})",
    "function",
    "Round a number.",
    [
      sig("ROUND(numeric, decimals)", {
        label: "numeric",
      }, { label: "decimals" }),
    ],
  ),
  fn(
    "SUM",
    "SUM(${1:expr})",
    "aggregate",
    "Sum of non-null values.",
    [sig("SUM(expr)", { label: "expr" })],
  ),
  fn(
    "SUBSTRING",
    "SUBSTRING(${1:string}, ${2:start}, ${3:length})",
    "function",
    "Extract a substring (syntax varies by dialect).",
    [
      sig(
        "SUBSTRING(string, start, length)",
        { label: "string" },
        { label: "start" },
        { label: "length" },
      ),
    ],
  ),
  fn(
    "TRIM",
    "TRIM(${1:string})",
    "function",
    "Trim whitespace (or specified characters).",
    [sig("TRIM(string)", { label: "string" })],
  ),
];

const ORACLE: SqlFunctionDef[] = [
  fn("SYSDATE", "SYSDATE", "function · Oracle", "Current date/time."),
  fn(
    "SYSTIMESTAMP",
    "SYSTIMESTAMP",
    "function · Oracle",
    "Current timestamp with time zone.",
  ),
  fn(
    "NVL",
    "NVL(${1:expr}, ${2:default})",
    "function · Oracle",
    "Replace NULL with a default.",
    [
      sig("NVL(expr, default)", {
        label: "expr",
      }, { label: "default" }),
    ],
  ),
  fn(
    "NVL2",
    "NVL2(${1:expr}, ${2:if_not_null}, ${3:if_null})",
    "function · Oracle",
    "Return one value if expr is not NULL, another if NULL.",
    [
      sig(
        "NVL2(expr, if_not_null, if_null)",
        { label: "expr" },
        { label: "if_not_null" },
        { label: "if_null" },
      ),
    ],
  ),
  fn(
    "DECODE",
    "DECODE(${1:expr}, ${2:search}, ${3:result}, ${4:default})",
    "function · Oracle",
    "Compare expr to search values (CASE-like).",
    [
      sig(
        "DECODE(expr, search, result [, …] [, default])",
        { label: "expr" },
        { label: "search" },
        { label: "result" },
        { label: "default" },
      ),
    ],
  ),
  fn(
    "TO_DATE",
    "TO_DATE(${1:string}, ${2:'YYYY-MM-DD'})",
    "function · Oracle",
    "Convert string to DATE.",
    [
      sig("TO_DATE(string, format)", {
        label: "string",
      }, { label: "format" }),
    ],
  ),
  fn(
    "TO_CHAR",
    "TO_CHAR(${1:value}, ${2:format})",
    "function · Oracle",
    "Convert value to string.",
    [
      sig("TO_CHAR(value, format)", {
        label: "value",
      }, { label: "format" }),
    ],
  ),
  fn(
    "TO_NUMBER",
    "TO_NUMBER(${1:string})",
    "function · Oracle",
    "Convert string to number.",
    [sig("TO_NUMBER(string)", { label: "string" })],
  ),
  fn(
    "TRUNC",
    "TRUNC(${1:date_or_number})",
    "function · Oracle",
    "Truncate date or number.",
    [sig("TRUNC(value [, format])", { label: "value" })],
  ),
  fn(
    "ADD_MONTHS",
    "ADD_MONTHS(${1:date}, ${2:n})",
    "function · Oracle",
    "Add months to a date.",
    [
      sig("ADD_MONTHS(date, n)", {
        label: "date",
      }, { label: "n" }),
    ],
  ),
  fn(
    "MONTHS_BETWEEN",
    "MONTHS_BETWEEN(${1:date1}, ${2:date2})",
    "function · Oracle",
    "Months between two dates.",
    [
      sig("MONTHS_BETWEEN(date1, date2)", {
        label: "date1",
      }, { label: "date2" }),
    ],
  ),
  fn(
    "INSTR",
    "INSTR(${1:string}, ${2:substring})",
    "function · Oracle",
    "Position of substring.",
    [
      sig("INSTR(string, substring)", {
        label: "string",
      }, { label: "substring" }),
    ],
  ),
  fn(
    "SUBSTR",
    "SUBSTR(${1:string}, ${2:start}, ${3:length})",
    "function · Oracle",
    "Substring (Oracle).",
    [
      sig(
        "SUBSTR(string, start [, length])",
        { label: "string" },
        { label: "start" },
        { label: "length" },
      ),
    ],
  ),
  fn(
    "LPAD",
    "LPAD(${1:string}, ${2:length}, ${3:pad})",
    "function · Oracle",
    "Left-pad a string.",
    [
      sig(
        "LPAD(string, length, pad)",
        { label: "string" },
        { label: "length" },
        { label: "pad" },
      ),
    ],
  ),
  fn(
    "RPAD",
    "RPAD(${1:string}, ${2:length}, ${3:pad})",
    "function · Oracle",
    "Right-pad a string.",
    [
      sig(
        "RPAD(string, length, pad)",
        { label: "string" },
        { label: "length" },
        { label: "pad" },
      ),
    ],
  ),
  fn(
    "GREATEST",
    "GREATEST(${1:expr1}, ${2:expr2})",
    "function · Oracle",
    "Greatest of the arguments.",
    [
      sig("GREATEST(expr1, expr2, …)", {
        label: "expr1",
      }, { label: "expr2" }),
    ],
  ),
  fn(
    "LEAST",
    "LEAST(${1:expr1}, ${2:expr2})",
    "function · Oracle",
    "Least of the arguments.",
    [
      sig("LEAST(expr1, expr2, …)", {
        label: "expr1",
      }, { label: "expr2" }),
    ],
  ),
];

const TSQL: SqlFunctionDef[] = [
  fn(
    "GETDATE",
    "GETDATE()",
    "function · T-SQL",
    "Current date/time.",
    [sig("GETDATE()")],
  ),
  fn(
    "GETUTCDATE",
    "GETUTCDATE()",
    "function · T-SQL",
    "Current UTC date/time.",
    [sig("GETUTCDATE()")],
  ),
  fn(
    "ISNULL",
    "ISNULL(${1:expr}, ${2:replacement})",
    "function · T-SQL",
    "Replace NULL with a replacement value.",
    [
      sig("ISNULL(expr, replacement)", {
        label: "expr",
      }, { label: "replacement" }),
    ],
  ),
  fn(
    "CONVERT",
    "CONVERT(${1:type}, ${2:expr})",
    "function · T-SQL",
    "Convert expression to type.",
    [
      sig("CONVERT(type, expr [, style])", {
        label: "type",
      }, { label: "expr" }),
    ],
  ),
  fn(
    "DATEADD",
    "DATEADD(${1:datepart}, ${2:number}, ${3:date})",
    "function · T-SQL",
    "Add an interval to a date.",
    [
      sig(
        "DATEADD(datepart, number, date)",
        { label: "datepart" },
        { label: "number" },
        { label: "date" },
      ),
    ],
  ),
  fn(
    "DATEDIFF",
    "DATEDIFF(${1:datepart}, ${2:start}, ${3:end})",
    "function · T-SQL",
    "Difference between two dates.",
    [
      sig(
        "DATEDIFF(datepart, start, end)",
        { label: "datepart" },
        { label: "start" },
        { label: "end" },
      ),
    ],
  ),
  fn(
    "DATEPART",
    "DATEPART(${1:datepart}, ${2:date})",
    "function · T-SQL",
    "Extract a part of a date.",
    [
      sig("DATEPART(datepart, date)", {
        label: "datepart",
      }, { label: "date" }),
    ],
  ),
  fn(
    "FORMAT",
    "FORMAT(${1:value}, ${2:format})",
    "function · T-SQL",
    "Format a value as a string.",
    [
      sig("FORMAT(value, format)", {
        label: "value",
      }, { label: "format" }),
    ],
  ),
  fn(
    "LEN",
    "LEN(${1:string})",
    "function · T-SQL",
    "String length.",
    [sig("LEN(string)", { label: "string" })],
  ),
  fn(
    "LEFT",
    "LEFT(${1:string}, ${2:length})",
    "function · T-SQL",
    "Leftmost characters.",
    [
      sig("LEFT(string, length)", {
        label: "string",
      }, { label: "length" }),
    ],
  ),
  fn(
    "RIGHT",
    "RIGHT(${1:string}, ${2:length})",
    "function · T-SQL",
    "Rightmost characters.",
    [
      sig("RIGHT(string, length)", {
        label: "string",
      }, { label: "length" }),
    ],
  ),
  fn(
    "CHARINDEX",
    "CHARINDEX(${1:substring}, ${2:string})",
    "function · T-SQL",
    "Position of substring.",
    [
      sig("CHARINDEX(substring, string)", {
        label: "substring",
      }, { label: "string" }),
    ],
  ),
  fn(
    "NEWID",
    "NEWID()",
    "function · T-SQL",
    "Generate a uniqueidentifier.",
    [sig("NEWID()")],
  ),
  fn(
    "SCOPE_IDENTITY",
    "SCOPE_IDENTITY()",
    "function · T-SQL",
    "Last identity value in the current scope.",
    [sig("SCOPE_IDENTITY()")],
  ),
];

const MYSQL: SqlFunctionDef[] = [
  fn(
    "IFNULL",
    "IFNULL(${1:expr}, ${2:default})",
    "function · MySQL",
    "Replace NULL with a default.",
    [
      sig("IFNULL(expr, default)", {
        label: "expr",
      }, { label: "default" }),
    ],
  ),
  fn("NOW", "NOW()", "function · MySQL", "Current date/time.", [sig("NOW()")]),
  fn(
    "CURDATE",
    "CURDATE()",
    "function · MySQL",
    "Current date.",
    [sig("CURDATE()")],
  ),
  fn(
    "CURTIME",
    "CURTIME()",
    "function · MySQL",
    "Current time.",
    [sig("CURTIME()")],
  ),
  fn(
    "DATE_FORMAT",
    "DATE_FORMAT(${1:date}, ${2:'%Y-%m-%d'})",
    "function · MySQL",
    "Format a date.",
    [
      sig("DATE_FORMAT(date, format)", {
        label: "date",
      }, { label: "format" }),
    ],
  ),
  fn(
    "STR_TO_DATE",
    "STR_TO_DATE(${1:string}, ${2:'%Y-%m-%d'})",
    "function · MySQL",
    "Parse a date string.",
    [
      sig("STR_TO_DATE(string, format)", {
        label: "string",
      }, { label: "format" }),
    ],
  ),
  fn(
    "GROUP_CONCAT",
    "GROUP_CONCAT(${1:expr})",
    "aggregate · MySQL",
    "Concatenate group values.",
    [sig("GROUP_CONCAT(expr)", { label: "expr" })],
  ),
  fn(
    "CONCAT",
    "CONCAT(${1:a}, ${2:b})",
    "function · MySQL",
    "Concatenate strings.",
    [sig("CONCAT(a, b, …)", { label: "a" }, { label: "b" })],
  ),
  fn(
    "IF",
    "IF(${1:condition}, ${2:true_value}, ${3:false_value})",
    "function · MySQL",
    "Conditional expression.",
    [
      sig(
        "IF(condition, true_value, false_value)",
        { label: "condition" },
        { label: "true_value" },
        { label: "false_value" },
      ),
    ],
  ),
  fn(
    "DATE_ADD",
    "DATE_ADD(${1:date}, INTERVAL ${2:n} ${3:DAY})",
    "function · MySQL",
    "Add an interval to a date.",
    [
      sig("DATE_ADD(date, INTERVAL n unit)", {
        label: "date",
      }, { label: "INTERVAL n unit" }),
    ],
  ),
  fn(
    "TIMESTAMPDIFF",
    "TIMESTAMPDIFF(${1:unit}, ${2:start}, ${3:end})",
    "function · MySQL",
    "Difference between timestamps.",
    [
      sig(
        "TIMESTAMPDIFF(unit, start, end)",
        { label: "unit" },
        { label: "start" },
        { label: "end" },
      ),
    ],
  ),
  fn(
    "UUID",
    "UUID()",
    "function · MySQL",
    "Generate a UUID string.",
    [sig("UUID()")],
  ),
];

const POSTGRES: SqlFunctionDef[] = [
  fn("NOW", "NOW()", "function · PostgreSQL", "Current timestamp.", [
    sig("NOW()"),
  ]),
  fn(
    "CURRENT_DATE",
    "CURRENT_DATE",
    "function · PostgreSQL",
    "Current date (no parentheses).",
  ),
  fn(
    "CURRENT_TIMESTAMP",
    "CURRENT_TIMESTAMP",
    "function · PostgreSQL",
    "Current timestamp (no parentheses).",
  ),
  fn(
    "date_trunc",
    "date_trunc(${1:'day'}, ${2:timestamp})",
    "function · PostgreSQL",
    "Truncate timestamp to precision.",
    [
      sig("date_trunc(field, source)", {
        label: "field",
      }, { label: "source" }),
    ],
  ),
  fn(
    "to_char",
    "to_char(${1:value}, ${2:format})",
    "function · PostgreSQL",
    "Format a value as text.",
    [
      sig("to_char(value, format)", {
        label: "value",
      }, { label: "format" }),
    ],
  ),
  fn(
    "to_date",
    "to_date(${1:string}, ${2:format})",
    "function · PostgreSQL",
    "Parse a date string.",
    [
      sig("to_date(string, format)", {
        label: "string",
      }, { label: "format" }),
    ],
  ),
  fn(
    "to_timestamp",
    "to_timestamp(${1:string}, ${2:format})",
    "function · PostgreSQL",
    "Parse a timestamp string.",
    [
      sig("to_timestamp(string, format)", {
        label: "string",
      }, { label: "format" }),
    ],
  ),
  fn(
    "GENERATE_SERIES",
    "GENERATE_SERIES(${1:start}, ${2:stop})",
    "function · PostgreSQL",
    "Generate a series of values.",
    [
      sig("GENERATE_SERIES(start, stop [, step])", {
        label: "start",
      }, { label: "stop" }),
    ],
  ),
  fn(
    "UNNEST",
    "UNNEST(${1:array})",
    "function · PostgreSQL",
    "Expand an array to a set of rows.",
    [sig("UNNEST(array)", { label: "array" })],
  ),
  fn(
    "CONCAT",
    "CONCAT(${1:a}, ${2:b})",
    "function · PostgreSQL",
    "Concatenate strings (NULL-safe).",
    [sig("CONCAT(a, b, …)", { label: "a" }, { label: "b" })],
  ),
  fn(
    "STRING_AGG",
    "STRING_AGG(${1:expr}, ${2:delimiter})",
    "aggregate · PostgreSQL",
    "Concatenate values with a delimiter.",
    [
      sig("STRING_AGG(expr, delimiter)", {
        label: "expr",
      }, { label: "delimiter" }),
    ],
  ),
  fn(
    "ARRAY_AGG",
    "ARRAY_AGG(${1:expr})",
    "aggregate · PostgreSQL",
    "Aggregate values into an array.",
    [sig("ARRAY_AGG(expr)", { label: "expr" })],
  ),
  fn(
    "jsonb_build_object",
    "jsonb_build_object(${1:key}, ${2:value})",
    "function · PostgreSQL",
    "Build a JSONB object.",
    [
      sig("jsonb_build_object(key, value, …)", {
        label: "key",
      }, { label: "value" }),
    ],
  ),
];

const DRIVER_FUNCTIONS: Record<ConnectionDriverId, SqlFunctionDef[]> = {
  oracle: ORACLE,
  sqlserver: TSQL,
  mysql: MYSQL,
  mariadb: MYSQL,
  postgresql: POSTGRES,
};

function mergeFunctions(defs: SqlFunctionDef[]): SqlFunctionDef[] {
  const byKey = new Map<string, SqlFunctionDef>();
  for (const def of defs) {
    const key = def.name.toLowerCase();
    // Later entries (driver-specific) override common when same name.
    byKey.set(key, def);
  }
  return [...byKey.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

/** Full function catalog for a driver (common + dialect extras). */
export function sqlFunctionsForDriver(
  driverId: ConnectionDriverId,
): SqlFunctionDef[] {
  return mergeFunctions([...COMMON, ...DRIVER_FUNCTIONS[driverId]]);
}

export function functionsForDriver(driverId: ConnectionDriverId): string[] {
  return sqlFunctionsForDriver(driverId).map((def) => def.name);
}

export function findSqlFunction(
  driverId: ConnectionDriverId,
  name: string,
): SqlFunctionDef | undefined {
  const needle = name.toLowerCase();
  return sqlFunctionsForDriver(driverId).find(
    (def) => def.name.toLowerCase() === needle,
  );
}

/**
 * Locate `name(` before the cursor and which argument index is active
 * (comma count at parenthesis depth 0 inside the call).
 */
export function parseFunctionCallAtCursor(textBeforeCursor: string): {
  name: string;
  activeParameter: number;
} | null {
  let depth = 0;
  let inSingle = false;
  let openParen = -1;

  for (let i = textBeforeCursor.length - 1; i >= 0; i -= 1) {
    const ch = textBeforeCursor[i];
    if (ch === "'") {
      // Walking backwards: treat '' as escaped by skipping one
      if (inSingle && textBeforeCursor[i - 1] === "'") {
        i -= 1;
        continue;
      }
      inSingle = !inSingle;
      continue;
    }
    if (inSingle) continue;
    if (ch === ")") {
      depth += 1;
      continue;
    }
    if (ch === "(") {
      if (depth === 0) {
        openParen = i;
        break;
      }
      depth -= 1;
    }
  }

  if (openParen < 0) return null;

  const before = textBeforeCursor.slice(0, openParen).trimEnd();
  const nameMatch = before.match(
    /([A-Za-z_\u0080-\uFFFF][\w\u0080-\uFFFF$]*)$/u,
  );
  if (!nameMatch) return null;

  const args = textBeforeCursor.slice(openParen + 1);
  let activeParameter = 0;
  depth = 0;
  inSingle = false;
  for (let i = 0; i < args.length; i += 1) {
    const ch = args[i];
    if (ch === "'" && !inSingle) {
      inSingle = true;
      continue;
    }
    if (ch === "'" && inSingle) {
      if (args[i + 1] === "'") {
        i += 1;
        continue;
      }
      inSingle = false;
      continue;
    }
    if (inSingle) continue;
    if (ch === "(") depth += 1;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === "," && depth === 0) activeParameter += 1;
  }

  return { name: nameMatch[1]!, activeParameter };
}
