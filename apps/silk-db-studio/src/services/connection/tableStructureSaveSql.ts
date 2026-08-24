import { tKey } from "@silk-studio/workbench/platform/i18n/activeLocale.ts";
import type { ConnectionDriverId } from "./connectionTypes";
import type { ColumnChange, EditableColumnDraft, TableStructureChangeSet } from "./tableStructureDiff";
import { formatColumnTypeParts } from "./tableColumnTypeFormat";
import { formatSqlLiteral, qualifyTableName, quoteIdentifier } from "../query/sqlLiteral";

export type TableStructureSaveSqlContext = {
  driverId: ConnectionDriverId;
  schemaName: string;
  /** The table's current (pre-rename) name — every statement but the trailing rename targets this. */
  tableName: string;
  catalogName?: string | null;
  /** Total column count before this save, used to block "drop every column". */
  existingColumnCount: number;
};

export type TableStructureSaveSqlResult = {
  /** Execute strictly in this order. */
  statements: string[];
  /** Shown in the dialog; allowed, confirm stays enabled. */
  warnings: string[];
  /** Non-empty means the dialog opens with Confirm disabled. */
  blockers: string[];
};

const IDENT_PATTERN = /^[\w$#]+$/i;

function alterChanges(changes: TableStructureChangeSet) {
  return changes.columns.filter(
    (c): c is Extract<ColumnChange, { op: "alter" }> => c.op === "alter",
  );
}
function dropChanges(changes: TableStructureChangeSet) {
  return changes.columns.filter((c): c is Extract<ColumnChange, { op: "drop" }> => c.op === "drop");
}
function addChanges(changes: TableStructureChangeSet) {
  return changes.columns.filter((c): c is Extract<ColumnChange, { op: "add" }> => c.op === "add");
}

function renderedType(draft: EditableColumnDraft): string {
  return formatColumnTypeParts(draft.typeName, draft.length, draft.scale);
}

// ---- Validation -----------------------------------------------------------------------

function collectBlockers(
  changes: TableStructureChangeSet,
  ctx: TableStructureSaveSqlContext,
): string[] {
  const blockers: string[] = [];
  const alters = alterChanges(changes);
  const adds = addChanges(changes);
  const drops = dropChanges(changes);

  for (const change of alters) {
    if (change.original.autoIncrement || change.original.generated) {
      blockers.push(
        tKey("app.tableStructure.blockerIdentityGenerated").replace(
          "{name}",
          change.original.name,
        ),
      );
    }
  }

  if (ctx.driverId === "sqlserver") {
    for (const change of alters) {
      if (change.defaultValue && !change.original.defaultConstraintName) {
        blockers.push(
          tKey("app.tableStructure.blockerUnknownDefaultConstraint").replace(
            "{name}",
            change.original.name,
          ),
        );
      }
    }
  }

  const seenNames = new Map<string, number>();
  for (const change of [...alters, ...adds]) {
    const name =
      change.op === "add" ? change.column.name.trim() : change.draft.name.trim();
    if (!name) {
      blockers.push(tKey("app.tableStructure.blockerEmptyName"));
      continue;
    }
    seenNames.set(name.toLowerCase(), (seenNames.get(name.toLowerCase()) ?? 0) + 1);
    const typeName = change.op === "add" ? change.column.typeName.trim() : change.draft.typeName.trim();
    if (!typeName) {
      blockers.push(tKey("app.tableStructure.blockerNoType").replace("{name}", name));
    }
    if (!IDENT_PATTERN.test(name)) {
      blockers.push(
        tKey("app.tableStructure.blockerInvalidColumnName").replace("{name}", name),
      );
    }
  }
  for (const [name, count] of seenNames) {
    if (count > 1) {
      blockers.push(tKey("app.tableStructure.blockerDuplicateName").replace("{name}", name));
    }
  }

  if (changes.tableRename) {
    const trimmed = changes.tableRename.after.trim();
    if (!trimmed) {
      blockers.push(tKey("app.tableStructure.blockerTableNameRequired"));
    } else if (!IDENT_PATTERN.test(trimmed)) {
      blockers.push(tKey("app.tableStructure.blockerTableNameInvalid"));
    }
  }

  const survivingColumnCount = ctx.existingColumnCount - drops.length + adds.length;
  if (survivingColumnCount <= 0 && ctx.existingColumnCount > 0) {
    blockers.push(tKey("app.tableStructure.blockerDropAllColumns"));
  }

  return blockers;
}

function looksLikeSafeWidening(before: string, after: string): boolean {
  const baseBefore = before.replace(/\(.*\)$/, "").trim().toUpperCase();
  const baseAfter = after.replace(/\(.*\)$/, "").trim().toUpperCase();
  if (baseBefore !== baseAfter) return false;
  const sizeOf = (rendered: string): number | null => {
    const match = /\((\d+)/.exec(rendered);
    return match ? Number(match[1]) : null;
  };
  const beforeSize = sizeOf(before);
  const afterSize = sizeOf(after);
  if (beforeSize === null || afterSize === null) return true;
  return afterSize >= beforeSize;
}

function collectWarnings(
  changes: TableStructureChangeSet,
  ctx: TableStructureSaveSqlContext,
): string[] {
  const warnings: string[] = [];
  const alters = alterChanges(changes);
  const adds = addChanges(changes);
  const drops = dropChanges(changes);

  for (const change of adds) {
    if (!change.column.nullable && !change.column.defaultValue) {
      warnings.push(
        tKey("app.tableStructure.warningNotNullNoDefault").replace(
          "{name}",
          change.column.name,
        ),
      );
    }
  }

  for (const change of drops) {
    warnings.push(
      tKey("app.tableStructure.warningColumnDropped").replace("{name}", change.original.name),
    );
  }

  for (const change of alters) {
    if (change.type) {
      if (!looksLikeSafeWidening(change.type.before, change.type.after)) {
        warnings.push(
          tKey("app.tableStructure.warningTypeChangeRisky")
            .replace("{name}", change.original.name)
            .replace("{before}", change.type.before)
            .replace("{after}", change.type.after),
        );
      }
      if (ctx.driverId === "postgresql") {
        warnings.push(
          tKey("app.tableStructure.warningPostgresUsingClause").replace(
            "{name}",
            change.original.name,
          ),
        );
      }
    }
    if (change.nullable && change.nullable.after === false) {
      warnings.push(
        tKey("app.tableStructure.warningBecomingNotNull").replace(
          "{name}",
          change.original.name,
        ),
      );
    }
    if (
      (ctx.driverId === "mysql" || ctx.driverId === "mariadb") &&
      !change.type &&
      !change.original.fullTypeName
    ) {
      warnings.push(
        tKey("app.tableStructure.warningMysqlTypeFidelity").replace(
          "{name}",
          change.original.name,
        ),
      );
    }
  }

  if (drops.length > 0 || alters.some((c) => c.type)) {
    warnings.push(tKey("app.tableStructure.warningNoConstraintVisibility"));
  }

  return warnings;
}

// ---- Statement builders -----------------------------------------------------------------

function tableRef(ctx: TableStructureSaveSqlContext, name: string): string {
  return qualifyTableName(ctx.schemaName, name, ctx.driverId, ctx.catalogName ?? undefined);
}

function qi(ctx: TableStructureSaveSqlContext, name: string): string {
  return quoteIdentifier(name, ctx.driverId);
}

function lit(ctx: TableStructureSaveSqlContext, value: string): string {
  return formatSqlLiteral(value, ctx.driverId);
}

function defaultClauseValue(after: string | null): string {
  return after === null ? "NULL" : after;
}

// -- Oracle --

function buildOracleStatements(
  changes: TableStructureChangeSet,
  ctx: TableStructureSaveSqlContext,
): string[] {
  const table = tableRef(ctx, ctx.tableName);
  const dropStmts: string[] = [];
  const renameStmts: string[] = [];
  const modifyStmts: string[] = [];
  const addStmts: string[] = [];
  const commentStmts: string[] = [];

  for (const change of dropChanges(changes)) {
    dropStmts.push(`ALTER TABLE ${table} DROP COLUMN ${qi(ctx, change.original.name)}`);
  }

  for (const change of alterChanges(changes)) {
    const finalName = change.draft.name.trim();
    if (change.renamed) {
      renameStmts.push(
        `ALTER TABLE ${table} RENAME COLUMN ${qi(ctx, change.renamed.before)} TO ${qi(ctx, change.renamed.after)}`,
      );
    }
    const parts: string[] = [];
    if (change.type) parts.push(renderedType(change.draft));
    if (change.defaultValue) parts.push(`DEFAULT ${defaultClauseValue(change.defaultValue.after)}`);
    if (change.nullable) parts.push(change.nullable.after ? "NULL" : "NOT NULL");
    if (parts.length > 0) {
      modifyStmts.push(`ALTER TABLE ${table} MODIFY (${qi(ctx, finalName)} ${parts.join(" ")})`);
    }
    if (change.comment) {
      commentStmts.push(
        `COMMENT ON COLUMN ${table}.${qi(ctx, finalName)} IS ${lit(ctx, change.comment.after ?? "")}`,
      );
    }
  }

  for (const change of addChanges(changes)) {
    const draft = change.column;
    const parts: string[] = [renderedType(draft)];
    if (draft.defaultValue) parts.push(`DEFAULT ${draft.defaultValue}`);
    if (!draft.nullable) parts.push("NOT NULL");
    addStmts.push(`ALTER TABLE ${table} ADD (${qi(ctx, draft.name.trim())} ${parts.join(" ")})`);
    if (draft.comment) {
      commentStmts.push(
        `COMMENT ON COLUMN ${table}.${qi(ctx, draft.name.trim())} IS ${lit(ctx, draft.comment)}`,
      );
    }
  }

  const tableCommentStmts: string[] = [];
  if (changes.tableComment) {
    tableCommentStmts.push(
      `COMMENT ON TABLE ${table} IS ${lit(ctx, changes.tableComment.after ?? "")}`,
    );
  }

  const tableRenameStmts: string[] = [];
  if (changes.tableRename) {
    tableRenameStmts.push(
      `ALTER TABLE ${table} RENAME TO ${qi(ctx, changes.tableRename.after)}`,
    );
  }

  return [
    ...dropStmts,
    ...renameStmts,
    ...modifyStmts,
    ...addStmts,
    ...commentStmts,
    ...tableCommentStmts,
    ...tableRenameStmts,
  ];
}

// -- PostgreSQL --

function buildPostgreSqlStatements(
  changes: TableStructureChangeSet,
  ctx: TableStructureSaveSqlContext,
): string[] {
  const table = tableRef(ctx, ctx.tableName);
  const dropStmts: string[] = [];
  const renameStmts: string[] = [];
  const modifyStmts: string[] = [];
  const addStmts: string[] = [];
  const commentStmts: string[] = [];

  for (const change of dropChanges(changes)) {
    dropStmts.push(`ALTER TABLE ${table} DROP COLUMN ${qi(ctx, change.original.name)}`);
  }

  for (const change of alterChanges(changes)) {
    const finalName = change.draft.name.trim();
    if (change.renamed) {
      renameStmts.push(
        `ALTER TABLE ${table} RENAME COLUMN ${qi(ctx, change.renamed.before)} TO ${qi(ctx, change.renamed.after)}`,
      );
    }
    const col = qi(ctx, finalName);
    if (change.type) {
      modifyStmts.push(`ALTER TABLE ${table} ALTER COLUMN ${col} TYPE ${renderedType(change.draft)}`);
    }
    if (change.nullable) {
      modifyStmts.push(
        `ALTER TABLE ${table} ALTER COLUMN ${col} ${change.nullable.after ? "DROP NOT NULL" : "SET NOT NULL"}`,
      );
    }
    if (change.defaultValue) {
      modifyStmts.push(
        change.defaultValue.after === null
          ? `ALTER TABLE ${table} ALTER COLUMN ${col} DROP DEFAULT`
          : `ALTER TABLE ${table} ALTER COLUMN ${col} SET DEFAULT ${change.defaultValue.after}`,
      );
    }
    if (change.comment) {
      commentStmts.push(
        `COMMENT ON COLUMN ${table}.${col} IS ${change.comment.after === null ? "NULL" : lit(ctx, change.comment.after)}`,
      );
    }
  }

  for (const change of addChanges(changes)) {
    const draft = change.column;
    const parts: string[] = [renderedType(draft)];
    if (!draft.nullable) parts.push("NOT NULL");
    if (draft.defaultValue) parts.push(`DEFAULT ${draft.defaultValue}`);
    addStmts.push(`ALTER TABLE ${table} ADD COLUMN ${qi(ctx, draft.name.trim())} ${parts.join(" ")}`);
    if (draft.comment) {
      commentStmts.push(
        `COMMENT ON COLUMN ${table}.${qi(ctx, draft.name.trim())} IS ${lit(ctx, draft.comment)}`,
      );
    }
  }

  const tableCommentStmts: string[] = [];
  if (changes.tableComment) {
    tableCommentStmts.push(
      `COMMENT ON TABLE ${table} IS ${changes.tableComment.after === null ? "NULL" : lit(ctx, changes.tableComment.after)}`,
    );
  }

  const tableRenameStmts: string[] = [];
  if (changes.tableRename) {
    tableRenameStmts.push(`ALTER TABLE ${table} RENAME TO ${qi(ctx, changes.tableRename.after)}`);
  }

  return [
    ...dropStmts,
    ...renameStmts,
    ...modifyStmts,
    ...addStmts,
    ...commentStmts,
    ...tableCommentStmts,
    ...tableRenameStmts,
  ];
}

// -- MySQL / MariaDB --

/** MySQL's CHANGE/MODIFY COLUMN always restates the *entire* definition, even for properties
 *  that didn't change — there is no "just rename" or "just add a comment" syntax. */
function buildMySqlFullDeclaration(
  ctx: TableStructureSaveSqlContext,
  change: Extract<ColumnChange, { op: "alter" }>,
): string {
  const draft = change.draft;
  const typeText = change.type
    ? renderedType(draft)
    : (change.original.fullTypeName ?? renderedType(draft));
  const parts: string[] = [typeText];
  parts.push(draft.nullable ? "NULL" : "NOT NULL");
  if (draft.defaultValue) parts.push(`DEFAULT ${draft.defaultValue}`);
  if (draft.comment) parts.push(`COMMENT ${lit(ctx, draft.comment)}`);
  return parts.join(" ");
}

function buildMySqlStatements(
  changes: TableStructureChangeSet,
  ctx: TableStructureSaveSqlContext,
): string[] {
  const table = tableRef(ctx, ctx.tableName);
  const dropStmts: string[] = [];
  const modifyStmts: string[] = [];
  const addStmts: string[] = [];

  for (const change of dropChanges(changes)) {
    dropStmts.push(`ALTER TABLE ${table} DROP COLUMN ${qi(ctx, change.original.name)}`);
  }

  for (const change of alterChanges(changes)) {
    const declaration = buildMySqlFullDeclaration(ctx, change);
    if (change.renamed) {
      modifyStmts.push(
        `ALTER TABLE ${table} CHANGE ${qi(ctx, change.renamed.before)} ${qi(ctx, change.renamed.after)} ${declaration}`,
      );
    } else {
      modifyStmts.push(
        `ALTER TABLE ${table} MODIFY COLUMN ${qi(ctx, change.draft.name.trim())} ${declaration}`,
      );
    }
  }

  for (const change of addChanges(changes)) {
    const draft = change.column;
    const parts: string[] = [renderedType(draft), draft.nullable ? "NULL" : "NOT NULL"];
    if (draft.defaultValue) parts.push(`DEFAULT ${draft.defaultValue}`);
    if (draft.comment) parts.push(`COMMENT ${lit(ctx, draft.comment)}`);
    addStmts.push(
      `ALTER TABLE ${table} ADD COLUMN ${qi(ctx, draft.name.trim())} ${parts.join(" ")}`,
    );
  }

  const tableCommentStmts: string[] = [];
  if (changes.tableComment) {
    tableCommentStmts.push(
      `ALTER TABLE ${table} COMMENT = ${lit(ctx, changes.tableComment.after ?? "")}`,
    );
  }

  const tableRenameStmts: string[] = [];
  if (changes.tableRename) {
    tableRenameStmts.push(`ALTER TABLE ${table} RENAME TO ${qi(ctx, changes.tableRename.after)}`);
  }

  return [...dropStmts, ...modifyStmts, ...addStmts, ...tableCommentStmts, ...tableRenameStmts];
}

// -- SQL Server --

function sqlServerExtendedPropertyArgs(
  ctx: TableStructureSaveSqlContext,
  columnName: string | null,
): string {
  const base =
    `@level0type=N'SCHEMA', @level0name=${lit(ctx, ctx.schemaName)}, ` +
    `@level1type=N'TABLE', @level1name=${lit(ctx, ctx.tableName)}`;
  return columnName === null
    ? base
    : `${base}, @level2type=N'COLUMN', @level2name=${lit(ctx, columnName)}`;
}

function sqlServerCommentStatements(
  ctx: TableStructureSaveSqlContext,
  columnName: string | null,
  before: string | null,
  after: string | null,
): string[] {
  if (before === after) return [];
  const args = sqlServerExtendedPropertyArgs(ctx, columnName);
  if (after === null) {
    return [`EXEC sp_dropextendedproperty @name=N'MS_Description', ${args}`];
  }
  const proc = before === null ? "sp_addextendedproperty" : "sp_updateextendedproperty";
  return [`EXEC ${proc} @name=N'MS_Description', @value=${lit(ctx, after)}, ${args}`];
}

function buildSqlServerStatements(
  changes: TableStructureChangeSet,
  ctx: TableStructureSaveSqlContext,
): string[] {
  const table = tableRef(ctx, ctx.tableName);
  const dropConstraintStmts: string[] = [];
  const dropColumnStmts: string[] = [];
  const renameStmts: string[] = [];
  const modifyStmts: string[] = [];
  const addDefaultStmts: string[] = [];
  const addColumnStmts: string[] = [];
  const commentStmts: string[] = [];

  const alters = alterChanges(changes);
  const drops = dropChanges(changes);

  for (const change of drops) {
    if (change.original.defaultConstraintName) {
      dropConstraintStmts.push(
        `ALTER TABLE ${table} DROP CONSTRAINT ${qi(ctx, change.original.defaultConstraintName)}`,
      );
    }
    dropColumnStmts.push(`ALTER TABLE ${table} DROP COLUMN ${qi(ctx, change.original.name)}`);
  }

  for (const change of alters) {
    if (
      (change.defaultValue || change.type) &&
      change.original.defaultConstraintName
    ) {
      dropConstraintStmts.push(
        `ALTER TABLE ${table} DROP CONSTRAINT ${qi(ctx, change.original.defaultConstraintName)}`,
      );
    }
  }

  for (const change of alters) {
    if (change.renamed) {
      const path = `${ctx.schemaName}.${ctx.tableName}.${change.renamed.before}`;
      renameStmts.push(`EXEC sp_rename ${lit(ctx, path)}, ${lit(ctx, change.renamed.after)}, 'COLUMN'`);
    }
  }

  for (const change of alters) {
    const finalName = change.draft.name.trim();
    if (change.type || change.nullable) {
      const parts = [renderedType(change.draft), change.draft.nullable ? "NULL" : "NOT NULL"];
      modifyStmts.push(
        `ALTER TABLE ${table} ALTER COLUMN ${qi(ctx, finalName)} ${parts.join(" ")}`,
      );
    }
    if (change.defaultValue && change.defaultValue.after !== null) {
      addDefaultStmts.push(
        `ALTER TABLE ${table} ADD DEFAULT ${change.defaultValue.after} FOR ${qi(ctx, finalName)}`,
      );
    }
    if (change.comment) {
      commentStmts.push(
        ...sqlServerCommentStatements(ctx, finalName, change.comment.before, change.comment.after),
      );
    }
  }

  for (const change of addChanges(changes)) {
    const draft = change.column;
    const parts: string[] = [renderedType(draft), draft.nullable ? "NULL" : "NOT NULL"];
    if (draft.defaultValue) parts.push(`DEFAULT ${draft.defaultValue}`);
    addColumnStmts.push(
      `ALTER TABLE ${table} ADD ${qi(ctx, draft.name.trim())} ${parts.join(" ")}`,
    );
    if (draft.comment) {
      commentStmts.push(...sqlServerCommentStatements(ctx, draft.name.trim(), null, draft.comment));
    }
  }

  const tableCommentStmts: string[] = [];
  if (changes.tableComment) {
    tableCommentStmts.push(
      ...sqlServerCommentStatements(ctx, null, changes.tableComment.before, changes.tableComment.after),
    );
  }

  const tableRenameStmts: string[] = [];
  if (changes.tableRename) {
    const path = `${ctx.schemaName}.${ctx.tableName}`;
    tableRenameStmts.push(
      `EXEC sp_rename ${lit(ctx, path)}, ${lit(ctx, changes.tableRename.after)}, 'OBJECT'`,
    );
  }

  return [
    ...dropConstraintStmts,
    ...dropColumnStmts,
    ...renameStmts,
    ...modifyStmts,
    ...addDefaultStmts,
    ...addColumnStmts,
    ...commentStmts,
    ...tableCommentStmts,
    ...tableRenameStmts,
  ];
}

// ---- Entry point ------------------------------------------------------------------------

export function buildTableStructureSaveSql(
  changes: TableStructureChangeSet,
  ctx: TableStructureSaveSqlContext,
): TableStructureSaveSqlResult {
  const blockers = collectBlockers(changes, ctx);
  const warnings = collectWarnings(changes, ctx);

  let statements: string[];
  switch (ctx.driverId) {
    case "oracle":
      statements = buildOracleStatements(changes, ctx);
      break;
    case "postgresql":
      statements = buildPostgreSqlStatements(changes, ctx);
      break;
    case "mysql":
    case "mariadb":
      statements = buildMySqlStatements(changes, ctx);
      break;
    case "sqlserver":
      statements = buildSqlServerStatements(changes, ctx);
      break;
    default:
      statements = [];
  }

  return { statements, warnings, blockers };
}
