export type QueryExecuteParams = {
  connectionId: string;
  sql: string;
  maxRows?: number;
  queryTimeoutSec?: number;
  autoCommit?: boolean;
  readOnly?: boolean;
  /** Positional bind values; JSON null → SQL NULL. */
  binds?: Array<string | null>;
};

export type ConnectionCredentials = {
  url: string;
  user: string;
  password: string;
  /**
   * Optional default schema applied after open.
   * Oracle: `ALTER SESSION SET CURRENT_SCHEMA`.
   * PostgreSQL: `SET search_path TO <schema>, public`.
   * SQL Server: informational only (no session-scoped equivalent), used for Explorer UI.
   */
  schema?: string;
  /**
   * Optional catalog/database applied after open (SQL Server / MySQL / MariaDB `USE`).
   * PostgreSQL: select the database in the JDBC URL path instead — pgJDBC cannot switch
   * databases after connect. Ignored by Oracle.
   */
  catalog?: string;
};

export type ConnectionOpenParams = ConnectionCredentials & {
  /** Stable session key (Silk uses connection profile id). */
  connectionId: string;
};

export type ConnectionOpenResult = {
  connected: boolean;
  connectionId: string;
};

export type ConnectionTestResult = {
  connected: boolean;
  message: string;
};

export type ConnectionCloseResult = {
  connected: boolean;
};

export type ConnectionCloseParams = {
  connectionId: string;
};

export type QueryCancelParams = {
  connectionId: string;
};

export type MetadataObjectKind =
  | "table"
  | "view"
  | "procedure"
  | "function"
  | "package"
  | "index"
  | "sequence"
  | "synonym"
  | "trigger"
  | "type";

export type MetadataObject = {
  name: string;
  kind: MetadataObjectKind;
};

/**
 * Stable Explorer object-group id shared with the jdbc-agent's `MetadataGroupId` enum. A
 * `DbDialect` only emits the groups its database actually has a concept of (e.g. MySQL never
 * emits `"packages"`), so the frontend renders exactly the groups present in a schema's
 * `groups` array instead of a fixed list. Display label/icon per id live in the frontend's
 * `services/connection/metadataGroups.ts` registry, not here.
 */
export type MetadataGroupId =
  | "tables"
  | "views"
  | "procedures"
  | "functions"
  | "packages"
  | "indexes"
  | "sequences"
  | "synonyms"
  | "triggers"
  | "types";

export type MetadataGroup = {
  id: MetadataGroupId;
  objects: MetadataObject[];
};

export type MetadataSchema = {
  name: string;
  /** Only groups the connected database supports are present here — see `MetadataGroupId`. */
  groups: MetadataGroup[];
};

/** Catalog/database entry for dialects with a Databases explorer level (SQL Server). */
export type MetadataCatalog = {
  name: string;
};

export type ConnectionMetadataParams = {
  connectionId: string;
  /** When set, return that schema with nested objects. */
  schema?: string;
  /**
   * When set (SQL Server catalog explorer), scopes schema/object listing to this database
   * and switches the session catalog (`USE`).
   */
  catalog?: string;
};

export type ConnectionMetadataResult = {
  schemas: MetadataSchema[];
  /** Present when listing catalogs (no schema/catalog filter) on catalog-explorer dialects. */
  catalogs?: MetadataCatalog[];
  /** Session catalog after the metadata call (when available). */
  currentCatalog?: string;
};

/** Column metadata for SQL autocomplete and the object editor's Columns section (`connection.columns`). */
export type MetadataColumn = {
  name: string;
  typeName?: string;
  /** JDBC `COLUMN_SIZE`: precision for numeric types, max length for character/binary types. */
  columnSize?: number;
  /** JDBC `DECIMAL_DIGITS`: scale, applicable to numeric types. */
  decimalDigits?: number;
  /** Omitted when the driver doesn't know (JDBC `columnNullableUnknown`). */
  nullable?: boolean;
  defaultValue?: string;
  comment?: string;
};

export type ConnectionColumnsParams = {
  connectionId: string;
  schema: string;
  table: string;
};

export type ConnectionColumnsResult = {
  columns: MetadataColumn[];
};

/** Package procedure/function members for SQL autocomplete (`connection.packageMembers`). */
export type MetadataPackageMember = {
  name: string;
  /** `"procedure"` or `"function"`. */
  kind: "procedure" | "function";
};

export type ConnectionPackageMembersParams = {
  connectionId: string;
  schema: string;
  package: string;
};

export type ConnectionPackageMembersResult = {
  members: MetadataPackageMember[];
};

/** Primary-key column metadata (`connection.primaryKeys`). */
export type MetadataPrimaryKeyColumn = {
  name: string;
};

/** Relation kind for cell-update eligibility (from explorer tab or JDBC metadata). */
export type QueryRelationKind = "table" | "view" | "materializedView";

export type ConnectionPrimaryKeysParams = {
  connectionId: string;
  schema: string;
  table: string;
};

export type ConnectionPrimaryKeysResult = {
  /** Resolved owner/schema when the request omitted schema. */
  schema?: string;
  keys: MetadataPrimaryKeyColumn[];
  /** When known: table / view / materializedView (for save messaging). */
  relationKind?: QueryRelationKind;
};

/** Index metadata for a single table (`connection.indexes`). */
export type MetadataIndex = {
  name: string;
  unique: boolean;
  /** Column names in index key order. */
  columns: string[];
};

export type ConnectionIndexesParams = {
  connectionId: string;
  schema: string;
  table: string;
};

export type ConnectionIndexesResult = {
  indexes: MetadataIndex[];
};

export type ConnectionTableCommentParams = {
  connectionId: string;
  schema: string;
  table: string;
};

export type ConnectionTableCommentResult = {
  /** Absent (not empty string) when the object has no comment. */
  comment?: string;
};

/** Foreign key metadata for a single table (this table as the referencing/child side). */
export type MetadataForeignKey = {
  name: string;
  /** FK columns on this table, in key sequence order. */
  columns: string[];
  referencedSchema?: string;
  referencedTable: string;
  /** Referenced columns, aligned by position with `columns`. */
  referencedColumns: string[];
  /** JDBC rule name, e.g. `"CASCADE"`, `"SET NULL"`, `"SET DEFAULT"`, `"RESTRICT"`, `"NO ACTION"`. */
  updateRule?: string;
  deleteRule?: string;
};

export type ConnectionForeignKeysParams = {
  connectionId: string;
  schema: string;
  table: string;
};

export type ConnectionForeignKeysResult = {
  foreignKeys: MetadataForeignKey[];
};

/**
 * Foreign key metadata for a single table as the *referenced* (parent) side — i.e. an entry per
 * other table's FK that points at this one. The mirror image of {@link MetadataForeignKey}.
 */
export type MetadataReference = {
  name: string;
  referencingSchema?: string;
  referencingTable: string;
  /** This table's columns being referenced, in key sequence order. */
  columns: string[];
  /** The referencing table's FK columns, aligned by position with `columns`. */
  referencingColumns: string[];
  updateRule?: string;
  deleteRule?: string;
};

export type ConnectionReferencesParams = {
  connectionId: string;
  schema: string;
  table: string;
};

export type ConnectionReferencesResult = {
  references: MetadataReference[];
};

/** Primary key / unique / check constraint metadata for a single table (`connection.constraints`). */
export type MetadataConstraint = {
  name: string;
  type: "primaryKey" | "unique" | "check";
  /** Column names, for `primaryKey`/`unique`. */
  columns?: string[];
  /** Check expression text, for `check`. */
  expression?: string;
};

export type ConnectionConstraintsParams = {
  connectionId: string;
  schema: string;
  table: string;
};

export type ConnectionConstraintsResult = {
  constraints: MetadataConstraint[];
};

/** Trigger metadata for a single table (`connection.triggers`). */
export type MetadataTrigger = {
  name: string;
  /** e.g. `"BEFORE"`, `"AFTER"`, `"INSTEAD OF"`. */
  timing?: string;
  /** e.g. `"INSERT"`, or a comma-joined list for multi-event triggers. */
  event?: string;
  enabled?: boolean;
};

export type ConnectionTriggersParams = {
  connectionId: string;
  schema: string;
  table: string;
};

export type ConnectionTriggersResult = {
  triggers: MetadataTrigger[];
};

export type ConnectionDdlParams = {
  connectionId: string;
  schema: string;
  name: string;
  kind: MetadataObjectKind;
  /**
   * When `kind === "package"`:
   * - `true` → PACKAGE BODY (`DBMS_METADATA` type PACKAGE_BODY)
   * - omit / `false` → PACKAGE (spec)
   */
  packageBody?: boolean;
};

export type ConnectionDdlResult = {
  ddl: string;
  dialectId: string;
};

/** Recompile a stored PL/SQL object (`connection.compile`). Oracle v1. */
export type ConnectionCompileParams = {
  connectionId: string;
  schema: string;
  name: string;
  kind: MetadataObjectKind;
  /**
   * When `kind === "package"`:
   * - `true` → PACKAGE BODY
   * - `false` → PACKAGE (spec)
   * - omit → compile both (Oracle `ALTER PACKAGE … COMPILE`)
   */
  packageBody?: boolean;
};

export type ConnectionCompileError = {
  /** 1-based line from ALL_ERRORS.LINE */
  line: number;
  /** 1-based column from ALL_ERRORS.POSITION */
  column: number;
  message: string;
  /** Oracle object type, e.g. PROCEDURE / PACKAGE BODY */
  type?: string;
  /** ERROR or WARNING */
  attribute?: string;
  sequence?: number;
};

export type ConnectionCompileResult = {
  /** True when `errors` is empty after compile. */
  success: boolean;
  dialectId: string;
  errors: ConnectionCompileError[];
};

/** Compile-time object reference (`connection.dependencies` / `connection.dependents`). */
export type ConnectionDependency = {
  /** Referenced (or referencing, for dependents) object owner/schema. */
  schema: string;
  name: string;
  /** e.g. `TABLE` / `VIEW` / `PACKAGE` / driver-specific object type text. */
  type: string;
  /** Oracle `DEPENDENCY_TYPE`, e.g. HARD / SOFT. Omitted on other drivers. */
  dependencyType?: string;
};

export type ConnectionDependenciesParams = {
  connectionId: string;
  schema: string;
  name: string;
  kind: MetadataObjectKind;
  /**
   * When `kind === "package"`:
   * - `true` → PACKAGE BODY
   * - omit / `false` → PACKAGE (spec)
   * - both spec+body when querying both is needed is handled by omitting for union (agent)
   */
  packageBody?: boolean;
};

export type ConnectionDependenciesResult = {
  dependencies: ConnectionDependency[];
  dialectId: string;
};

/** Reverse of `connection.dependencies` — objects that reference this one. */
export type ConnectionDependentsParams = ConnectionDependenciesParams;

export type ConnectionDependentsResult = {
  dependents: ConnectionDependency[];
  dialectId: string;
};

export type AgentMethod =
  | "agent.ping"
  | "agent.shutdown"
  | "connection.open"
  | "connection.close"
  | "connection.test"
  | "connection.metadata"
  | "connection.columns"
  | "connection.packageMembers"
  | "connection.primaryKeys"
  | "connection.ddl"
  | "connection.compile"
  | "connection.dependencies"
  | "query.execute"
  | "query.cancel";

export type AgentRequest<TParams = unknown> = {
  id: number;
  method: AgentMethod;
  params: TParams;
};

export type AgentError = {
  message: string;
  sqlState?: string | null;
  errorCode?: number;
};

export type AgentResponse<TResult = unknown> = {
  id: number | null;
  ok: boolean;
  result?: TResult;
  error?: AgentError;
};

export type QueryResultKind = "resultSet" | "update";

export type QueryResultPayload = {
  kind: QueryResultKind;
  columns: string[];
  rows: Array<Array<string | null>>;
  rowCount: number;
  updateCount: number | null;
  message: string;
  /** True when the agent stopped at maxRows and more rows may exist. */
  truncated?: boolean;
};

export function isQueryResultPayload(
  value: unknown,
): value is QueryResultPayload {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    (record.kind === "resultSet" || record.kind === "update") &&
    Array.isArray(record.columns) &&
    record.columns.every((column) => typeof column === "string") &&
    Array.isArray(record.rows) &&
    record.rows.every(
      (row) =>
        Array.isArray(row) &&
        row.every((cell) => cell === null || typeof cell === "string"),
    ) &&
    typeof record.rowCount === "number" &&
    (record.updateCount === null || typeof record.updateCount === "number") &&
    typeof record.message === "string" &&
    (record.truncated === undefined || typeof record.truncated === "boolean")
  );
}

const KNOWN_METADATA_GROUP_IDS = new Set<MetadataGroupId>([
  "tables",
  "views",
  "procedures",
  "functions",
  "packages",
  "indexes",
  "sequences",
  "synonyms",
  "triggers",
  "types",
]);

function isMetadataObject(value: unknown): value is MetadataObject {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.name === "string" &&
    (entry.kind === "table" ||
      entry.kind === "view" ||
      entry.kind === "procedure" ||
      entry.kind === "function" ||
      entry.kind === "package" ||
      entry.kind === "index" ||
      entry.kind === "sequence" ||
      entry.kind === "synonym" ||
      entry.kind === "trigger" ||
      entry.kind === "type")
  );
}

function isMetadataGroup(value: unknown): value is MetadataGroup {
  if (!value || typeof value !== "object") return false;
  const group = value as Record<string, unknown>;
  return (
    typeof group.id === "string" &&
    KNOWN_METADATA_GROUP_IDS.has(group.id as MetadataGroupId) &&
    Array.isArray(group.objects) &&
    group.objects.every(isMetadataObject)
  );
}

export function isConnectionMetadataResult(
  value: unknown,
): value is ConnectionMetadataResult {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.schemas)) return false;
  const schemasOk = record.schemas.every((schema) => {
    if (!schema || typeof schema !== "object") return false;
    const item = schema as Record<string, unknown>;
    return (
      typeof item.name === "string" &&
      Array.isArray(item.groups) &&
      item.groups.every(isMetadataGroup)
    );
  });
  if (!schemasOk) return false;
  if (record.currentCatalog !== undefined && typeof record.currentCatalog !== "string") {
    return false;
  }
  if (record.catalogs === undefined) return true;
  if (!Array.isArray(record.catalogs)) return false;
  return record.catalogs.every((catalog) => {
    if (!catalog || typeof catalog !== "object") return false;
    return typeof (catalog as Record<string, unknown>).name === "string";
  });
}

function isMetadataColumn(value: unknown): value is MetadataColumn {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.name === "string" &&
    (entry.typeName === undefined || typeof entry.typeName === "string") &&
    (entry.columnSize === undefined || typeof entry.columnSize === "number") &&
    (entry.decimalDigits === undefined || typeof entry.decimalDigits === "number") &&
    (entry.nullable === undefined || typeof entry.nullable === "boolean") &&
    (entry.defaultValue === undefined || typeof entry.defaultValue === "string") &&
    (entry.comment === undefined || typeof entry.comment === "string")
  );
}

export function isConnectionColumnsResult(
  value: unknown,
): value is ConnectionColumnsResult {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    Array.isArray(record.columns) && record.columns.every(isMetadataColumn)
  );
}

function isMetadataPackageMember(
  value: unknown,
): value is MetadataPackageMember {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.name === "string" &&
    (entry.kind === "procedure" || entry.kind === "function")
  );
}

export function isConnectionPackageMembersResult(
  value: unknown,
): value is ConnectionPackageMembersResult {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    Array.isArray(record.members) &&
    record.members.every(isMetadataPackageMember)
  );
}

function isQueryRelationKind(value: unknown): value is QueryRelationKind {
  return (
    value === "table" || value === "view" || value === "materializedView"
  );
}

function isMetadataPrimaryKeyColumn(
  value: unknown,
): value is MetadataPrimaryKeyColumn {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.name === "string";
}

export function isConnectionPrimaryKeysResult(
  value: unknown,
): value is ConnectionPrimaryKeysResult {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    Array.isArray(record.keys) &&
    record.keys.every(isMetadataPrimaryKeyColumn) &&
    (record.schema === undefined || typeof record.schema === "string") &&
    (record.relationKind === undefined ||
      isQueryRelationKind(record.relationKind))
  );
}

function isMetadataIndex(value: unknown): value is MetadataIndex {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.name === "string" &&
    typeof entry.unique === "boolean" &&
    Array.isArray(entry.columns) &&
    entry.columns.every((column) => typeof column === "string")
  );
}

export function isConnectionIndexesResult(
  value: unknown,
): value is ConnectionIndexesResult {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    Array.isArray(record.indexes) && record.indexes.every(isMetadataIndex)
  );
}

export function isConnectionTableCommentResult(
  value: unknown,
): value is ConnectionTableCommentResult {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.comment === undefined || typeof record.comment === "string";
}

function isMetadataForeignKey(value: unknown): value is MetadataForeignKey {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.name === "string" &&
    Array.isArray(entry.columns) &&
    entry.columns.every((column) => typeof column === "string") &&
    typeof entry.referencedTable === "string" &&
    Array.isArray(entry.referencedColumns) &&
    entry.referencedColumns.every((column) => typeof column === "string") &&
    (entry.referencedSchema === undefined ||
      typeof entry.referencedSchema === "string") &&
    (entry.updateRule === undefined || typeof entry.updateRule === "string") &&
    (entry.deleteRule === undefined || typeof entry.deleteRule === "string")
  );
}

export function isConnectionForeignKeysResult(
  value: unknown,
): value is ConnectionForeignKeysResult {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    Array.isArray(record.foreignKeys) &&
    record.foreignKeys.every(isMetadataForeignKey)
  );
}

function isMetadataReference(value: unknown): value is MetadataReference {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.name === "string" &&
    typeof entry.referencingTable === "string" &&
    Array.isArray(entry.columns) &&
    entry.columns.every((column) => typeof column === "string") &&
    Array.isArray(entry.referencingColumns) &&
    entry.referencingColumns.every((column) => typeof column === "string") &&
    (entry.referencingSchema === undefined ||
      typeof entry.referencingSchema === "string") &&
    (entry.updateRule === undefined || typeof entry.updateRule === "string") &&
    (entry.deleteRule === undefined || typeof entry.deleteRule === "string")
  );
}

export function isConnectionReferencesResult(
  value: unknown,
): value is ConnectionReferencesResult {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    Array.isArray(record.references) &&
    record.references.every(isMetadataReference)
  );
}

function isMetadataConstraint(value: unknown): value is MetadataConstraint {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.name === "string" &&
    (entry.type === "primaryKey" ||
      entry.type === "unique" ||
      entry.type === "check") &&
    (entry.columns === undefined ||
      (Array.isArray(entry.columns) &&
        entry.columns.every((column) => typeof column === "string"))) &&
    (entry.expression === undefined || typeof entry.expression === "string")
  );
}

export function isConnectionConstraintsResult(
  value: unknown,
): value is ConnectionConstraintsResult {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    Array.isArray(record.constraints) &&
    record.constraints.every(isMetadataConstraint)
  );
}

function isMetadataTrigger(value: unknown): value is MetadataTrigger {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.name === "string" &&
    (entry.timing === undefined || typeof entry.timing === "string") &&
    (entry.event === undefined || typeof entry.event === "string") &&
    (entry.enabled === undefined || typeof entry.enabled === "boolean")
  );
}

export function isConnectionTriggersResult(
  value: unknown,
): value is ConnectionTriggersResult {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    Array.isArray(record.triggers) && record.triggers.every(isMetadataTrigger)
  );
}

export function isConnectionDdlResult(
  value: unknown,
): value is ConnectionDdlResult {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.ddl === "string" &&
    typeof record.dialectId === "string"
  );
}

function isConnectionCompileError(
  value: unknown,
): value is ConnectionCompileError {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.line === "number" &&
    typeof entry.column === "number" &&
    typeof entry.message === "string" &&
    (entry.type === undefined || typeof entry.type === "string") &&
    (entry.attribute === undefined || typeof entry.attribute === "string") &&
    (entry.sequence === undefined || typeof entry.sequence === "number")
  );
}

export function isConnectionCompileResult(
  value: unknown,
): value is ConnectionCompileResult {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.success === "boolean" &&
    typeof record.dialectId === "string" &&
    Array.isArray(record.errors) &&
    record.errors.every(isConnectionCompileError)
  );
}

function isConnectionDependency(value: unknown): value is ConnectionDependency {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.schema === "string" &&
    typeof entry.name === "string" &&
    typeof entry.type === "string" &&
    (entry.dependencyType === undefined ||
      typeof entry.dependencyType === "string")
  );
}

export function isConnectionDependenciesResult(
  value: unknown,
): value is ConnectionDependenciesResult {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.dialectId === "string" &&
    Array.isArray(record.dependencies) &&
    record.dependencies.every(isConnectionDependency)
  );
}

export function isConnectionDependentsResult(
  value: unknown,
): value is ConnectionDependentsResult {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.dialectId === "string" &&
    Array.isArray(record.dependents) &&
    record.dependents.every(isConnectionDependency)
  );
}
