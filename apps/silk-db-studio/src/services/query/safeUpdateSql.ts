import type { ConnectionDriverId } from "../connection/connectionTypes";
import type { QueryResultColumnType } from "@silk-studio/db-protocol";
import {
  formatSqlLiteral,
  formatTableReference,
  quoteIdentifier,
} from "./sqlLiteral";
import {
  currentTemporalSql,
  isCurrentTimestampValue,
} from "./queryResultTemporalValue";

export type DirtyRowChange = {
  column: string;
  originalValue: string | null;
  currentValue: string | null;
};

export type DirtyRow = {
  rowIndex: number;
  changes: DirtyRowChange[];
};

/**
 * Shared by `buildUpdateStatement`/`buildDeleteStatement` — a row is only ever identified by its
 * primary key values as they were when the grid loaded (`originalRow`), never by edited/current
 * values, so a statement can't accidentally target the wrong row after other columns changed.
 */
function buildPrimaryKeyWhereClause(input: {
  driverId: ConnectionDriverId;
  primaryKeys: string[];
  originalRow: Record<string, string | null>;
  columnTypes?: Record<string, QueryResultColumnType | undefined>;
}): string {
  return input.primaryKeys
    .map((key) => {
      const value = input.originalRow[key] ?? null;
      return `${quoteIdentifier(key, input.driverId)} = ${formatColumnValue(value, input.driverId, input.columnTypes?.[key])}`;
    })
    .join(" AND ");
}

export function buildUpdateStatement(input: {
  catalog?: string | null;
  schema: string | null;
  table: string;
  driverId: ConnectionDriverId;
  primaryKeys: string[];
  originalRow: Record<string, string | null>;
  changes: DirtyRowChange[];
  columnTypes?: Record<string, QueryResultColumnType | undefined>;
}): string {
  const tableRef = formatTableReference(
    input.schema,
    input.table,
    input.driverId,
    input.catalog,
  );
  const setClause = input.changes
    .map(
      (change) =>
        `${quoteIdentifier(change.column, input.driverId)} = ${formatColumnValue(change.currentValue, input.driverId, input.columnTypes?.[change.column])}`,
    )
    .join(", ");
  const whereClause = buildPrimaryKeyWhereClause(input);

  return `UPDATE ${tableRef} SET ${setClause} WHERE ${whereClause}`;
}

export function buildDeleteStatement(input: {
  catalog?: string | null;
  schema: string | null;
  table: string;
  driverId: ConnectionDriverId;
  primaryKeys: string[];
  originalRow: Record<string, string | null>;
  columnTypes?: Record<string, QueryResultColumnType | undefined>;
}): string {
  const tableRef = formatTableReference(
    input.schema,
    input.table,
    input.driverId,
    input.catalog,
  );
  const whereClause = buildPrimaryKeyWhereClause(input);
  return `DELETE FROM ${tableRef} WHERE ${whereClause}`;
}

export function buildDeleteStatements(input: {
  catalog?: string | null;
  schema: string | null;
  table: string;
  driverId: ConnectionDriverId;
  primaryKeys: string[];
  originalRows: Array<Record<string, string | null>>;
  deletedRowIndexes: number[];
  columnTypes?: Record<string, QueryResultColumnType | undefined>;
}): string[] {
  return input.deletedRowIndexes.map((rowIndex) =>
    buildDeleteStatement({
      catalog: input.catalog,
      schema: input.schema,
      table: input.table,
      driverId: input.driverId,
      primaryKeys: input.primaryKeys,
      originalRow: input.originalRows[rowIndex] ?? {},
      columnTypes: input.columnTypes,
    }),
  );
}

export function buildInsertStatement(input: {
  catalog?: string | null;
  schema: string | null;
  table: string;
  driverId: ConnectionDriverId;
  columns: string[];
  row: Record<string, string | null>;
  columnTypes?: Record<string, QueryResultColumnType | undefined>;
}): string {
  const tableRef = formatTableReference(
    input.schema,
    input.table,
    input.driverId,
    input.catalog,
  );
  const columnList = input.columns
    .map((column) => quoteIdentifier(column, input.driverId))
    .join(", ");
  const valueList = input.columns
    .map((column) => formatColumnValue(input.row[column] ?? null, input.driverId, input.columnTypes?.[column]))
    .join(", ");
  return `INSERT INTO ${tableRef} (${columnList}) VALUES (${valueList})`;
}

type InsertStatementsInput = {
  catalog?: string | null;
  schema: string | null;
  table: string;
  driverId: ConnectionDriverId;
  columns: string[];
  rows: Array<Record<string, string | null>>;
  columnTypes?: Record<string, QueryResultColumnType | undefined>;
};

export function buildInsertStatements(input: InsertStatementsInput): string[] {
  return Array.from(iterateInsertBatches(input), (batch) => batch.sql);
}

/** Format only the next bounded batch; do not materialize SQL for all rows. */
export function* iterateInsertBatches(input: InsertStatementsInput): Generator<{ sql: string; rowCount: number }> {
  if (input.rows.length === 0) return;
  const tableRef = formatTableReference(
    input.schema,
    input.table,
    input.driverId,
    input.catalog,
  );
  const columnList = input.columns
    .map((column) => quoteIdentifier(column, input.driverId))
    .join(", ");
  const oracle = input.driverId === "oracle";
  const maxRowsPerStatement = 50;
  const maxStatementLength = oracle ? 24_000 : 128_000;
  const prefix = oracle
    ? "INSERT ALL\n"
    : `INSERT INTO ${tableRef} (${columnList}) VALUES\n`;
  const suffix = oracle ? "\nSELECT 1 FROM DUAL" : "";
  const fragmentForRow = (row: Record<string, string | null>) => {
    const values = input.columns
      .map((column) => formatColumnValue(
        row[column] ?? null,
        input.driverId,
        input.columnTypes?.[column],
      ))
      .join(", ");
    return oracle
      ? `INTO ${tableRef} (${columnList}) VALUES (${values})`
      : `(${values})`;
  };

  let batch: string[] = [];
  let batchLength = prefix.length + suffix.length;
  for (const row of input.rows) {
    const fragment = fragmentForRow(row);
    const separatorLength = batch.length === 0 ? 0 : oracle ? 1 : 2;
    if (
      batch.length > 0 &&
      (batch.length >= maxRowsPerStatement ||
        batchLength + separatorLength + fragment.length > maxStatementLength)
    ) {
      yield { sql: `${prefix}${batch.join(oracle ? "\n" : ",\n")}${suffix}`, rowCount: batch.length };
      batch = [];
      batchLength = prefix.length + suffix.length;
    }
    batchLength += (batch.length === 0 ? 0 : oracle ? 1 : 2) + fragment.length;
    batch.push(fragment);
  }
  if (batch.length > 0) {
    yield { sql: `${prefix}${batch.join(oracle ? "\n" : ",\n")}${suffix}`, rowCount: batch.length };
  }
}

export function buildUpdateStatements(input: {
  catalog?: string | null;
  schema: string | null;
  table: string;
  driverId: ConnectionDriverId;
  primaryKeys: string[];
  originalRows: Array<Record<string, string | null>>;
  dirtyRows: DirtyRow[];
  columnTypes?: Record<string, QueryResultColumnType | undefined>;
}): string[] {
  return input.dirtyRows.map((row) =>
    buildUpdateStatement({
      catalog: input.catalog,
      schema: input.schema,
      table: input.table,
      driverId: input.driverId,
      primaryKeys: input.primaryKeys,
      originalRow: input.originalRows[row.rowIndex] ?? {},
      changes: row.changes,
      columnTypes: input.columnTypes,
    }),
  );
}

function formatColumnValue(
  value: string | null,
  driverId: ConnectionDriverId,
  columnType?: QueryResultColumnType,
): string {
  if (isCurrentTimestampValue(value)) {
    return currentTemporalSql(driverId, columnType?.jdbcType);
  }
  // Keep an explicit empty value as a literal. In particular, do not wrap it in TO_TIMESTAMP
  // or another temporal parser; Oracle itself applies its empty-string semantics on assignment.
  if (value === null || value === "" || !columnType) {
    return formatSqlLiteral(value, driverId);
  }
  const literal = formatSqlLiteral(value, driverId);
  const temporalKind = temporalKindForJdbcType(columnType.jdbcType);
  if (!temporalKind) return literal;

  // The grid always supplies the same ISO-like text. Use an explicit conversion where a
  // database may otherwise interpret that text according to a session-level date format.
  switch (driverId) {
    case "oracle":
      if (temporalKind === "date") {
        return /\d{2}:\d{2}/.test(value)
          ? `TO_DATE(${literal}, 'YYYY-MM-DD HH24:MI:SS')`
          : `TO_DATE(${literal}, 'YYYY-MM-DD')`;
      }
      if (temporalKind === "time") {
        return `TO_DATE(${literal}, 'HH24:MI:SS')`;
      }
      return /\.\d+$/.test(value)
        ? `TO_TIMESTAMP(${literal}, 'YYYY-MM-DD HH24:MI:SS.FF')`
        : `TO_TIMESTAMP(${literal}, 'YYYY-MM-DD HH24:MI:SS')`;
    case "sqlserver":
      return temporalKind === "date"
        ? `CONVERT(date, ${literal}, 23)`
        : temporalKind === "time"
          ? `CONVERT(time, ${literal}, 108)`
          : `CONVERT(datetime2, ${literal}, 120)`;
    case "postgresql":
      return `${literal}::${temporalKind === "timestamp" ? "timestamp" : temporalKind}`;
    case "mysql":
    case "mariadb":
      return `CAST(${literal} AS ${temporalKind === "timestamp" ? "DATETIME" : temporalKind.toUpperCase()})`;
    default:
      // SQLite stores ISO temporal values directly and preserves the canonical grid value.
      return literal;
  }
}

function temporalKindForJdbcType(jdbcType: number): "date" | "time" | "timestamp" | null {
  if (jdbcType === 91) return "date";
  if (jdbcType === 92) return "time";
  if (jdbcType === 93) return "timestamp";
  return null;
}
