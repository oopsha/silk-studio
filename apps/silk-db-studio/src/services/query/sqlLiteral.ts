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

export function formatSqlLiteral(value: string | null): string {
  if (value === null) {
    return "NULL";
  }
  return `'${value.replace(/'/g, "''")}'`;
}

export function qualifyTableName(
  schema: string,
  table: string,
  driverId: ConnectionDriverId,
): string {
  return `${quoteIdentifier(schema, driverId)}.${quoteIdentifier(table, driverId)}`;
}

export function formatTableReference(
  schema: string | null | undefined,
  table: string,
  driverId: ConnectionDriverId,
): string {
  const trimmedSchema = schema?.trim();
  if (!trimmedSchema) {
    return quoteIdentifier(table, driverId);
  }
  return qualifyTableName(trimmedSchema, table, driverId);
}
