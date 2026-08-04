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
  | "package";

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
  | "packages";

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

/** Column metadata for SQL autocomplete (`connection.columns`). */
export type MetadataColumn = {
  name: string;
  typeName?: string;
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

export type ConnectionPrimaryKeysParams = {
  connectionId: string;
  schema: string;
  table: string;
};

export type ConnectionPrimaryKeysResult = {
  /** Resolved owner/schema when the request omitted schema. */
  schema?: string;
  keys: MetadataPrimaryKeyColumn[];
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
      entry.kind === "package")
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
    (entry.typeName === undefined || typeof entry.typeName === "string")
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
    (record.schema === undefined || typeof record.schema === "string")
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
