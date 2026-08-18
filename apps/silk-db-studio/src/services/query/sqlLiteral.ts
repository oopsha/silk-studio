import type { ConnectionDriverId } from "../connection/connectionTypes";

export function quoteIdentifier(
  name: string,
  driverId: ConnectionDriverId,
): string {
  switch (driverId) {
    case "mysql":
    case "mariadb":
      return `\`${name.replace(/`/g, "``")}\``;
    case "sqlserver":
      return `[${name.replace(/]/g, "]]")}]`;
    default:
      return `"${name.replace(/"/g, '""')}"`;
  }
}

/**
 * SQL Server ignores its NVARCHAR column type for an unprefixed string literal:
 * the literal is first read as the database's default (non-Unicode) collation
 * codepage, so any character outside it (e.g. Korean under a Western collation)
 * is silently replaced with `?` before the implicit NVARCHAR conversion even
 * happens. The `N` prefix marks the literal as Unicode from the start.
 */
export function formatSqlLiteral(
  value: string | null,
  driverId?: ConnectionDriverId,
): string {
  if (value === null) {
    return "NULL";
  }
  const prefix = driverId === "sqlserver" ? "N" : "";
  return `${prefix}'${value.replace(/'/g, "''")}'`;
}

export function qualifyTableName(
  schema: string,
  table: string,
  driverId: ConnectionDriverId,
  catalog?: string | null,
): string {
  const catalogPrefix = catalog?.trim()
    ? `${quoteIdentifier(catalog.trim(), driverId)}.`
    : "";
  return `${catalogPrefix}${quoteIdentifier(schema, driverId)}.${quoteIdentifier(table, driverId)}`;
}

/**
 * `catalog` produces a 3-part reference (e.g. SQL Server `[DB].[schema].[table]`) so a query
 * can target an object resolved from a non-current catalog without switching the shared JDBC
 * session's database — see openTableDataService.ts.
 */
export function formatTableReference(
  schema: string | null | undefined,
  table: string,
  driverId: ConnectionDriverId,
  catalog?: string | null,
): string {
  const trimmedSchema = schema?.trim();
  if (!trimmedSchema) {
    return quoteIdentifier(table, driverId);
  }
  return qualifyTableName(trimmedSchema, table, driverId, catalog);
}
