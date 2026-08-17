import type { ConnectionDriverId } from "../connection/connectionTypes";
import {
  formatSqlLiteral,
  formatTableReference,
  quoteIdentifier,
} from "./sqlLiteral";

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
}): string {
  return input.primaryKeys
    .map((key) => {
      const value = input.originalRow[key] ?? null;
      return `${quoteIdentifier(key, input.driverId)} = ${formatSqlLiteral(value, input.driverId)}`;
    })
    .join(" AND ");
}

export function buildUpdateStatement(input: {
  schema: string | null;
  table: string;
  driverId: ConnectionDriverId;
  primaryKeys: string[];
  originalRow: Record<string, string | null>;
  changes: DirtyRowChange[];
}): string {
  const tableRef = formatTableReference(input.schema, input.table, input.driverId);
  const setClause = input.changes
    .map(
      (change) =>
        `${quoteIdentifier(change.column, input.driverId)} = ${formatSqlLiteral(change.currentValue, input.driverId)}`,
    )
    .join(", ");
  const whereClause = buildPrimaryKeyWhereClause(input);

  return `UPDATE ${tableRef} SET ${setClause} WHERE ${whereClause}`;
}

export function buildDeleteStatement(input: {
  schema: string | null;
  table: string;
  driverId: ConnectionDriverId;
  primaryKeys: string[];
  originalRow: Record<string, string | null>;
}): string {
  const tableRef = formatTableReference(input.schema, input.table, input.driverId);
  const whereClause = buildPrimaryKeyWhereClause(input);
  return `DELETE FROM ${tableRef} WHERE ${whereClause}`;
}

export function buildDeleteStatements(input: {
  schema: string | null;
  table: string;
  driverId: ConnectionDriverId;
  primaryKeys: string[];
  originalRows: Array<Record<string, string | null>>;
  deletedRowIndexes: number[];
}): string[] {
  return input.deletedRowIndexes.map((rowIndex) =>
    buildDeleteStatement({
      schema: input.schema,
      table: input.table,
      driverId: input.driverId,
      primaryKeys: input.primaryKeys,
      originalRow: input.originalRows[rowIndex] ?? {},
    }),
  );
}

export function buildUpdateStatements(input: {
  schema: string | null;
  table: string;
  driverId: ConnectionDriverId;
  primaryKeys: string[];
  originalRows: Array<Record<string, string | null>>;
  dirtyRows: DirtyRow[];
}): string[] {
  return input.dirtyRows.map((row) =>
    buildUpdateStatement({
      schema: input.schema,
      table: input.table,
      driverId: input.driverId,
      primaryKeys: input.primaryKeys,
      originalRow: input.originalRows[row.rowIndex] ?? {},
      changes: row.changes,
    }),
  );
}
