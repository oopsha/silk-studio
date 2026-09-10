import type { ConnectionDriverId } from "./connectionTypes";
import { formatTableReference, quoteIdentifier } from "../query/sqlLiteral";

export type CreateTableTarget = {
  profileId: string;
  schemaName: string;
  /** SQL Server database/catalog when the selected schema belongs to a non-current database. */
  catalogName?: string | null;
};

export type CreateTableColumnDraft = {
  id: string;
  name: string;
  typeName: string;
  length?: number;
  scale?: number;
  nullable: boolean;
  defaultValue?: string;
  comment?: string;
  /** One-based position in the primary key. Omit when the column is not a key column. */
  primaryKeyOrder?: number;
};

export type CreateTableDraft = CreateTableTarget & {
  tableName: string;
  tableComment?: string;
  columns: CreateTableColumnDraft[];
};

/**
 * Provides a usable, non-conflicting starting name when duplicating a table. Object names are
 * compared case-insensitively because that is the usual behavior of the supported database
 * collations and avoids offering an immediately conflicting name on SQL Server/MySQL.
 */
export function suggestCopiedTableName(
  sourceName: string,
  existingNames: Iterable<string>,
): string {
  const existing = new Set(
    [...existingNames].map((name) => name.trim().toLocaleLowerCase()),
  );
  const base = `${sourceName}_Copy`;
  if (!existing.has(base.toLocaleLowerCase())) return base;

  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}${suffix}`;
    if (!existing.has(candidate.toLocaleLowerCase())) return candidate;
  }
}

function defaultIdType(driverId: ConnectionDriverId): string {
  return driverId === "oracle" ? "NUMBER" : "INTEGER";
}

/** Produces the portable CREATE TABLE starter placed into the new, bound SQL editor. */
export function buildCreateTableSql(
  driverId: ConnectionDriverId,
  target: CreateTableTarget,
): string {
  const tableName = "NEW_TABLE";
  const idName = "ID";
  const tableRef = formatTableReference(
    target.schemaName,
    tableName,
    driverId,
    target.catalogName,
  );
  const idRef = quoteIdentifier(idName, driverId);

  return [
    `CREATE TABLE ${tableRef} (`,
    `  ${idRef} ${defaultIdType(driverId)} NOT NULL,`,
    `  PRIMARY KEY (${idRef})`,
    `);`,
  ].join("\n");
}

function quoteString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function columnDefinition(driverId: ConnectionDriverId, column: CreateTableColumnDraft): string {
  const size =
    column.length === undefined
      ? ""
      : column.scale === undefined
        ? `(${column.length})`
        : `(${column.length}, ${column.scale})`;
  const nullable = column.nullable ? "" : " NOT NULL";
  const defaultValue = column.defaultValue?.trim() ? ` DEFAULT ${column.defaultValue.trim()}` : "";
  const mysqlComment =
    driverId === "mysql" && column.comment?.trim()
      ? ` COMMENT ${quoteString(column.comment.trim())}`
      : "";
  // SQLite has no native COMMENT statement. Keeping a block comment in its initial CREATE
  // definition is safe; existing SQLite tables are deliberately never recreated for comments.
  const sqliteComment =
    driverId === "sqlite" && column.comment?.trim()
      ? ` /* ${column.comment.replace(/\*\//g, "* /").trim()} */`
      : "";
  return `  ${quoteIdentifier(column.name.trim(), driverId)} ${column.typeName.trim()}${size}${nullable}${defaultValue}${mysqlComment}${sqliteComment}`;
}

/**
 * Builds a CREATE TABLE statement for a draft object. Primary-key ordering is explicit rather
 * than inferred from grid row order so a composite key remains stable when columns are reordered.
 */
export function buildCreateTableDraftStatements(
  driverId: ConnectionDriverId,
  draft: CreateTableDraft,
): string[] {
  const tableRef = formatTableReference(
    draft.schemaName,
    draft.tableName.trim(),
    driverId,
    draft.catalogName,
  );
  const keyColumns = [...draft.columns]
    .filter((column) => column.primaryKeyOrder !== undefined)
    .sort((left, right) => (left.primaryKeyOrder ?? 0) - (right.primaryKeyOrder ?? 0));
  const definitions = draft.columns.map((column) => columnDefinition(driverId, column));
  if (keyColumns.length > 0) {
    definitions.push(
      `  PRIMARY KEY (${keyColumns.map((column) => quoteIdentifier(column.name.trim(), driverId)).join(", ")})`,
    );
  }
  const mysqlTableComment =
    driverId === "mysql" && draft.tableComment?.trim()
      ? ` COMMENT = ${quoteString(draft.tableComment.trim())}`
      : "";
  const sqliteTableComment =
    driverId === "sqlite" && draft.tableComment?.trim()
      ? `/* ${draft.tableComment.replace(/\*\//g, "* /").trim()} */\n`
      : "";
  const statements = [
    [
      `${sqliteTableComment}CREATE TABLE ${tableRef} (`,
      definitions.join(",\n"),
      `)${mysqlTableComment};`,
    ].join("\n"),
  ];
  if (driverId === "postgresql" || driverId === "oracle") {
    if (draft.tableComment?.trim()) {
      statements.push(`COMMENT ON TABLE ${tableRef} IS ${quoteString(draft.tableComment.trim())};`);
    }
    for (const column of draft.columns) {
      if (column.comment?.trim()) {
        statements.push(
          `COMMENT ON COLUMN ${tableRef}.${quoteIdentifier(column.name.trim(), driverId)} IS ${quoteString(column.comment.trim())};`,
        );
      }
    }
  }
  if (driverId === "sqlserver") {
    const catalogPrefix = draft.catalogName?.trim()
      ? `${quoteIdentifier(draft.catalogName.trim(), driverId)}.`
      : "";
    const proc = `${catalogPrefix}sys.sp_addextendedproperty`;
    const scope = `@level0type=N'SCHEMA', @level0name=N${quoteString(draft.schemaName)}, @level1type=N'TABLE', @level1name=N${quoteString(draft.tableName.trim())}`;
    if (draft.tableComment?.trim()) {
      statements.push(`EXEC ${proc} @name=N'MS_Description', @value=N${quoteString(draft.tableComment.trim())}, ${scope};`);
    }
    for (const column of draft.columns) {
      if (column.comment?.trim()) {
        statements.push(`EXEC ${proc} @name=N'MS_Description', @value=N${quoteString(column.comment.trim())}, ${scope}, @level2type=N'COLUMN', @level2name=N${quoteString(column.name.trim())};`);
      }
    }
  }
  return statements;
}

export function buildCreateTableDraftSql(driverId: ConnectionDriverId, draft: CreateTableDraft): string {
  return buildCreateTableDraftStatements(driverId, draft).join("\n\n");
}
