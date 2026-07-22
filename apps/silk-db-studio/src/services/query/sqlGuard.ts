const WRITE_SQL_PATTERN =
  /^\s*(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|call|exec|execute)\b/i;

export function isWriteSql(sql: string): boolean {
  return WRITE_SQL_PATTERN.test(sql.trim());
}

export function assertReadOnlyQueryAllowed(sql: string, readOnly: boolean): void {
  if (!readOnly) return;
  if (isWriteSql(sql)) {
    throw new Error(
      "Read-only mode is enabled. Write statements (INSERT, UPDATE, DELETE, DDL, etc.) are blocked.",
    );
  }
}
