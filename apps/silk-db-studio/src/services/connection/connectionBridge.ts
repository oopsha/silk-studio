import { invoke, isTauri } from "@tauri-apps/api/core";
import { invokeJdbcCommand } from "./jdbcInvoke";
import {
  isConnectionColumnsResult,
  isConnectionConstraintsResult,
  isConnectionFindObjectsByNameResult,
  isConnectionForeignKeysResult,
  isConnectionIndexesResult,
  isConnectionMetadataResult,
  isConnectionPackageMembersResult,
  isConnectionReferencesResult,
  isConnectionTableCommentResult,
  isConnectionTriggersResult,
  type ConnectionColumnsResult,
  type ConnectionConstraintsResult,
  type ConnectionCredentials,
  type ConnectionFindObjectsByNameResult,
  type ConnectionForeignKeysResult,
  type ConnectionIndexesResult,
  type ConnectionMetadataResult,
  type ConnectionPackageMembersResult,
  type ConnectionReferencesResult,
  type ConnectionTableCommentResult,
  type ConnectionTriggersResult,
  type MetadataObjectKind,
} from "@silk-studio/db-protocol";

export async function bridgeConnect(
  connectionId: string,
  credentials: ConnectionCredentials,
): Promise<void> {
  if (!isTauri()) {
    throw new Error("Database connections are available in the desktop app only.");
  }
  const id = connectionId.trim();
  if (!id) {
    throw new Error("connectionId is required.");
  }
  await invoke("connection_connect", {
    connectionId: id,
    url: credentials.url,
    user: credentials.user,
    password: credentials.password,
    schema: credentials.schema?.trim() ? credentials.schema.trim() : null,
    catalog: credentials.catalog?.trim() ? credentials.catalog.trim() : null,
  });
}

export async function bridgeDisconnect(connectionId: string): Promise<void> {
  if (!isTauri()) return;
  const id = connectionId.trim();
  if (!id) return;
  await invoke("connection_disconnect", { connectionId: id });
}

export async function bridgeTestConnection(
  credentials: ConnectionCredentials,
): Promise<void> {
  if (!isTauri()) {
    throw new Error("Connection test is available in the desktop app only.");
  }
  await invoke("connection_test", {
    url: credentials.url,
    user: credentials.user,
    password: credentials.password,
    schema: credentials.schema?.trim() ? credentials.schema.trim() : null,
    catalog: credentials.catalog?.trim() ? credentials.catalog.trim() : null,
  });
}

export async function bridgeListMetadata(
  connectionId: string,
  schema?: string,
  catalog?: string,
  includeSecondaryKinds?: boolean,
): Promise<ConnectionMetadataResult> {
  if (!isTauri()) {
    throw new Error("Database metadata is available in the desktop app only.");
  }
  const id = connectionId.trim();
  if (!id) {
    throw new Error("connectionId is required.");
  }
  const payload = await invokeJdbcCommand<unknown>("connection_metadata", {
    connectionId: id,
    schema: schema?.trim() ? schema.trim() : null,
    catalog: catalog?.trim() ? catalog.trim() : null,
    includeSecondaryKinds: includeSecondaryKinds ?? null,
  }, id);
  if (!isConnectionMetadataResult(payload)) {
    throw new Error("Invalid connection metadata payload from desktop bridge.");
  }
  return payload;
}

/**
 * Finds tables/views named exactly `name`, across every schema (and catalog, for SQL Server)
 * the connection can see — no schema required from the caller. Backs the AI assistant's
 * find_object_by_name tool.
 */
export async function bridgeFindObjectsByName(
  connectionId: string,
  name: string,
  options?: {
    contains?: boolean;
    kinds?: MetadataObjectKind[];
    /** Default `true` (search everything) — matches the pre-filter behavior for every caller
     *  that doesn't pass this. */
    includeSystemObjects?: boolean;
  },
): Promise<ConnectionFindObjectsByNameResult> {
  if (!isTauri()) {
    throw new Error("Database metadata is available in the desktop app only.");
  }
  const id = connectionId.trim();
  if (!id) {
    throw new Error("connectionId is required.");
  }
  const payload = await invokeJdbcCommand<unknown>(
    "connection_find_objects_by_name",
    {
      connectionId: id,
      name: name.trim(),
      contains: options?.contains ?? false,
      kinds: options?.kinds && options.kinds.length > 0 ? options.kinds : undefined,
      includeSystemObjects: options?.includeSystemObjects,
    },
    id,
  );
  if (!isConnectionFindObjectsByNameResult(payload)) {
    throw new Error("Invalid find-objects-by-name payload from desktop bridge.");
  }
  return payload;
}

export async function bridgeListColumns(
  connectionId: string,
  schema: string,
  table: string,
  catalog?: string,
): Promise<ConnectionColumnsResult> {
  if (!isTauri()) {
    throw new Error("Database metadata is available in the desktop app only.");
  }
  const id = connectionId.trim();
  if (!id) {
    throw new Error("connectionId is required.");
  }
  const payload = await invokeJdbcCommand<unknown>("connection_columns", {
    connectionId: id,
    schema: schema.trim(),
    table: table.trim(),
    catalog: catalog?.trim() ? catalog.trim() : null,
  }, id);
  if (!isConnectionColumnsResult(payload)) {
    throw new Error("Invalid connection columns payload from desktop bridge.");
  }
  return payload;
}

export async function bridgeListIndexes(
  connectionId: string,
  schema: string,
  table: string,
  catalog?: string,
): Promise<ConnectionIndexesResult> {
  if (!isTauri()) {
    throw new Error("Database metadata is available in the desktop app only.");
  }
  const id = connectionId.trim();
  if (!id) {
    throw new Error("connectionId is required.");
  }
  const payload = await invokeJdbcCommand<unknown>("connection_indexes", {
    connectionId: id,
    schema: schema.trim(),
    table: table.trim(),
    catalog: catalog?.trim() ? catalog.trim() : null,
  }, id);
  if (!isConnectionIndexesResult(payload)) {
    throw new Error("Invalid connection indexes payload from desktop bridge.");
  }
  return payload;
}

export async function bridgeGetTableComment(
  connectionId: string,
  schema: string,
  table: string,
  catalog?: string,
): Promise<ConnectionTableCommentResult> {
  if (!isTauri()) {
    throw new Error("Database metadata is available in the desktop app only.");
  }
  const id = connectionId.trim();
  if (!id) {
    throw new Error("connectionId is required.");
  }
  const payload = await invokeJdbcCommand<unknown>("connection_table_comment", {
    connectionId: id,
    schema: schema.trim(),
    table: table.trim(),
    catalog: catalog?.trim() ? catalog.trim() : null,
  }, id);
  if (!isConnectionTableCommentResult(payload)) {
    throw new Error("Invalid connection table comment payload from desktop bridge.");
  }
  return payload;
}

export async function bridgeListForeignKeys(
  connectionId: string,
  schema: string,
  table: string,
  catalog?: string,
): Promise<ConnectionForeignKeysResult> {
  if (!isTauri()) {
    throw new Error("Database metadata is available in the desktop app only.");
  }
  const id = connectionId.trim();
  if (!id) {
    throw new Error("connectionId is required.");
  }
  const payload = await invokeJdbcCommand<unknown>("connection_foreign_keys", {
    connectionId: id,
    schema: schema.trim(),
    table: table.trim(),
    catalog: catalog?.trim() ? catalog.trim() : null,
  }, id);
  if (!isConnectionForeignKeysResult(payload)) {
    throw new Error("Invalid connection foreign keys payload from desktop bridge.");
  }
  return payload;
}

export async function bridgeListReferences(
  connectionId: string,
  schema: string,
  table: string,
  catalog?: string,
): Promise<ConnectionReferencesResult> {
  if (!isTauri()) {
    throw new Error("Database metadata is available in the desktop app only.");
  }
  const id = connectionId.trim();
  if (!id) {
    throw new Error("connectionId is required.");
  }
  const payload = await invokeJdbcCommand<unknown>("connection_references", {
    connectionId: id,
    schema: schema.trim(),
    table: table.trim(),
    catalog: catalog?.trim() ? catalog.trim() : null,
  }, id);
  if (!isConnectionReferencesResult(payload)) {
    throw new Error("Invalid connection references payload from desktop bridge.");
  }
  return payload;
}

export async function bridgeListConstraints(
  connectionId: string,
  schema: string,
  table: string,
  catalog?: string,
): Promise<ConnectionConstraintsResult> {
  if (!isTauri()) {
    throw new Error("Database metadata is available in the desktop app only.");
  }
  const id = connectionId.trim();
  if (!id) {
    throw new Error("connectionId is required.");
  }
  const payload = await invokeJdbcCommand<unknown>("connection_constraints", {
    connectionId: id,
    schema: schema.trim(),
    table: table.trim(),
    catalog: catalog?.trim() ? catalog.trim() : null,
  }, id);
  if (!isConnectionConstraintsResult(payload)) {
    throw new Error("Invalid connection constraints payload from desktop bridge.");
  }
  return payload;
}

export async function bridgeListTriggers(
  connectionId: string,
  schema: string,
  table: string,
  catalog?: string,
): Promise<ConnectionTriggersResult> {
  if (!isTauri()) {
    throw new Error("Database metadata is available in the desktop app only.");
  }
  const id = connectionId.trim();
  if (!id) {
    throw new Error("connectionId is required.");
  }
  const payload = await invokeJdbcCommand<unknown>("connection_triggers", {
    connectionId: id,
    schema: schema.trim(),
    table: table.trim(),
    catalog: catalog?.trim() ? catalog.trim() : null,
  }, id);
  if (!isConnectionTriggersResult(payload)) {
    throw new Error("Invalid connection triggers payload from desktop bridge.");
  }
  return payload;
}

export async function bridgeListPackageMembers(
  connectionId: string,
  schema: string,
  packageName: string,
  catalog?: string,
): Promise<ConnectionPackageMembersResult> {
  if (!isTauri()) {
    throw new Error("Database metadata is available in the desktop app only.");
  }
  const id = connectionId.trim();
  if (!id) {
    throw new Error("connectionId is required.");
  }
  const payload = await invokeJdbcCommand<unknown>("connection_package_members", {
    connectionId: id,
    schema: schema.trim(),
    package: packageName.trim(),
    catalog: catalog?.trim() ? catalog.trim() : null,
  }, id);
  if (!isConnectionPackageMembersResult(payload)) {
    throw new Error(
      "Invalid connection package members payload from desktop bridge.",
    );
  }
  return payload;
}

export type ConnectionCommitResult = {
  committed: boolean;
  skipped: boolean;
  reason?: string;
};

function isConnectionCommitResult(
  value: unknown,
): value is ConnectionCommitResult {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.committed === "boolean" &&
    typeof record.skipped === "boolean"
  );
}

/** Commits the open JDBC transaction when auto-commit is off. */
export async function bridgeCommit(
  connectionId: string,
): Promise<ConnectionCommitResult> {
  if (!isTauri()) {
    return { committed: false, skipped: true, reason: "notDesktop" };
  }
  const id = connectionId.trim();
  if (!id) {
    throw new Error("connectionId is required.");
  }
  const payload = await invokeJdbcCommand<unknown>("connection_commit", {
    connectionId: id,
  }, id);
  if (!isConnectionCommitResult(payload)) {
    throw new Error("Invalid connection commit payload from desktop bridge.");
  }
  return payload;
}

export type ConnectionRollbackResult = {
  rolledBack: boolean;
  skipped: boolean;
  reason?: string;
};

function isConnectionRollbackResult(
  value: unknown,
): value is ConnectionRollbackResult {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.rolledBack === "boolean" &&
    typeof record.skipped === "boolean"
  );
}

/** Rolls back the open JDBC transaction when auto-commit is off. */
export async function bridgeRollback(
  connectionId: string,
): Promise<ConnectionRollbackResult> {
  if (!isTauri()) {
    return { rolledBack: false, skipped: true, reason: "notDesktop" };
  }
  const id = connectionId.trim();
  if (!id) {
    throw new Error("connectionId is required.");
  }
  const payload = await invokeJdbcCommand<unknown>("connection_rollback", {
    connectionId: id,
  }, id);
  if (!isConnectionRollbackResult(payload)) {
    throw new Error("Invalid connection rollback payload from desktop bridge.");
  }
  return payload;
}

/** Sets the JDBC session catalog (database). Does not change profile defaults. */
export async function bridgeSetCatalog(
  connectionId: string,
  catalog: string,
): Promise<string> {
  if (!isTauri()) {
    throw new Error("Database connections are available in the desktop app only.");
  }
  const id = connectionId.trim();
  const name = catalog.trim();
  if (!id) {
    throw new Error("connectionId is required.");
  }
  if (!name) {
    throw new Error("catalog is required.");
  }
  const payload = await invokeJdbcCommand<unknown>("connection_set_catalog", {
    connectionId: id,
    catalog: name,
  }, id);
  if (
    payload &&
    typeof payload === "object" &&
    typeof (payload as { catalog?: unknown }).catalog === "string" &&
    (payload as { catalog: string }).catalog.trim()
  ) {
    return (payload as { catalog: string }).catalog.trim();
  }
  return name;
}

/** Sets the JDBC session's current schema (Oracle/PostgreSQL). Does not change profile defaults. */
export async function bridgeSetSchema(
  connectionId: string,
  schema: string,
): Promise<string> {
  if (!isTauri()) {
    throw new Error("Database connections are available in the desktop app only.");
  }
  const id = connectionId.trim();
  const name = schema.trim();
  if (!id) {
    throw new Error("connectionId is required.");
  }
  if (!name) {
    throw new Error("schema is required.");
  }
  const payload = await invokeJdbcCommand<unknown>("connection_set_schema", {
    connectionId: id,
    schema: name,
  }, id);
  if (
    payload &&
    typeof payload === "object" &&
    typeof (payload as { schema?: unknown }).schema === "string" &&
    (payload as { schema: string }).schema.trim()
  ) {
    return (payload as { schema: string }).schema.trim();
  }
  return name;
}
