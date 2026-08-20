import { tKey } from "@silk-studio/workbench/platform/i18n/activeLocale.ts";

const WRITE_SQL_PATTERN =
  /^\s*(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|call|exec|execute)\b/i;

/** DDL/DCL keywords — the subset of {@link WRITE_SQL_PATTERN} that Oracle/MySQL implicitly
 *  commit on execution (see `driverAutoCommitsDdl` in sqlDialect.ts). `call`/`exec`/
 *  `execute` and the DML keywords are left out: those run inside the normal transaction. */
const DDL_SQL_PATTERN =
  /^\s*(drop|alter|create|truncate|grant|revoke)\b/i;

/** One leading `-- ...` line comment (through its newline, or to end of string) or one leading
 *  `/* ... *\/` block comment, anchored at the start of the (remaining) input. */
const LEADING_COMMENT_PATTERN = /^\s*(--[^\n]*(\n|$)|\/\*[\s\S]*?\*\/)/;

/**
 * Strips leading SQL comments/whitespace so {@link isWriteSql} can see the real first keyword —
 * `"-- note\nDELETE FROM t"` must still be classified as a write. Mirrors the JDBC agent's own
 * `stripLeadingComments` (Main.java), which gates the actual read-only-mode DML block server-side
 * — this client-side copy only drives the status bar's dirty indicator, so it's UX-only here, but
 * kept in sync with the server logic to avoid the two disagreeing.
 */
function stripLeadingComments(sql: string): string {
  let rest = sql;
  for (;;) {
    const match = rest.match(LEADING_COMMENT_PATTERN);
    if (!match) return rest;
    rest = rest.slice(match[0].length);
  }
}

export function isWriteSql(sql: string): boolean {
  return WRITE_SQL_PATTERN.test(stripLeadingComments(sql));
}

export function isDdlSql(sql: string): boolean {
  return DDL_SQL_PATTERN.test(stripLeadingComments(sql));
}

export function assertReadOnlyQueryAllowed(sql: string, readOnly: boolean): void {
  if (!readOnly) return;
  if (isWriteSql(sql)) {
    throw new Error(tKey("app.query.readOnlyBlocked"));
  }
}
