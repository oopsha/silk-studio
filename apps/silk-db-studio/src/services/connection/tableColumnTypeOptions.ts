import type { ConnectionDriverId } from "./connectionTypes";

/**
 * Curated common column types per dialect, for the table structure editor's Type dropdown.
 * Not exhaustive and not validated server-side — an existing column's type is always kept
 * selectable even if it isn't in this list (see `withCurrentValue` below), so nothing already
 * on the table is ever hidden or silently rewritten by opening the dropdown.
 */
const COLUMN_TYPE_OPTIONS: Record<ConnectionDriverId, string[]> = {
  oracle: [
    "VARCHAR2",
    "NVARCHAR2",
    "CHAR",
    "NCHAR",
    "CLOB",
    "NCLOB",
    "NUMBER",
    "INTEGER",
    "FLOAT",
    "BINARY_FLOAT",
    "BINARY_DOUBLE",
    "DATE",
    "TIMESTAMP",
    "BLOB",
    "RAW",
    "LONG",
  ],
  postgresql: [
    "varchar",
    "char",
    "text",
    "integer",
    "bigint",
    "smallint",
    "numeric",
    "real",
    "double precision",
    "boolean",
    "date",
    "timestamp",
    "timestamptz",
    "time",
    "uuid",
    "json",
    "jsonb",
    "bytea",
  ],
  mysql: [
    "VARCHAR",
    "CHAR",
    "TEXT",
    "TINYTEXT",
    "MEDIUMTEXT",
    "LONGTEXT",
    "INT",
    "BIGINT",
    "SMALLINT",
    "TINYINT",
    "DECIMAL",
    "FLOAT",
    "DOUBLE",
    "DATE",
    "DATETIME",
    "TIMESTAMP",
    "TIME",
    "BOOLEAN",
    "BLOB",
    "JSON",
    "ENUM",
  ],
  mariadb: [
    "VARCHAR",
    "CHAR",
    "TEXT",
    "TINYTEXT",
    "MEDIUMTEXT",
    "LONGTEXT",
    "INT",
    "BIGINT",
    "SMALLINT",
    "TINYINT",
    "DECIMAL",
    "FLOAT",
    "DOUBLE",
    "DATE",
    "DATETIME",
    "TIMESTAMP",
    "TIME",
    "BOOLEAN",
    "BLOB",
    "JSON",
    "ENUM",
  ],
  sqlserver: [
    "varchar",
    "nvarchar",
    "char",
    "nchar",
    "text",
    "ntext",
    "int",
    "bigint",
    "smallint",
    "tinyint",
    "decimal",
    "numeric",
    "float",
    "real",
    "bit",
    "date",
    "datetime",
    "datetime2",
    "time",
    "uniqueidentifier",
    "varbinary",
  ],
};

export function getColumnTypeOptions(driverId: ConnectionDriverId): string[] {
  return COLUMN_TYPE_OPTIONS[driverId];
}

/** Ensures `currentValue` is selectable even when it isn't one of the curated options above. */
export function columnTypeOptionsWithCurrentValue(
  driverId: ConnectionDriverId,
  currentValue: string,
): string[] {
  const options = getColumnTypeOptions(driverId);
  const trimmed = currentValue.trim();
  if (!trimmed || options.some((option) => option.toLowerCase() === trimmed.toLowerCase())) {
    return options;
  }
  return [trimmed, ...options];
}
