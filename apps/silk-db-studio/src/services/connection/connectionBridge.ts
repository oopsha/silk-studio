import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  isConnectionColumnsResult,
  isConnectionMetadataResult,
  isConnectionPackageMembersResult,
  type ConnectionColumnsResult,
  type ConnectionCredentials,
  type ConnectionMetadataResult,
  type ConnectionPackageMembersResult,
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
): Promise<ConnectionMetadataResult> {
  if (!isTauri()) {
    throw new Error("Database metadata is available in the desktop app only.");
  }
  const id = connectionId.trim();
  if (!id) {
    throw new Error("connectionId is required.");
  }
  const payload = await invoke<unknown>("connection_metadata", {
    connectionId: id,
    schema: schema?.trim() ? schema.trim() : null,
    catalog: catalog?.trim() ? catalog.trim() : null,
  });
  if (!isConnectionMetadataResult(payload)) {
    throw new Error("Invalid connection metadata payload from desktop bridge.");
  }
  return payload;
}

export async function bridgeListColumns(
  connectionId: string,
  schema: string,
  table: string,
): Promise<ConnectionColumnsResult> {
  if (!isTauri()) {
    throw new Error("Database metadata is available in the desktop app only.");
  }
  const id = connectionId.trim();
  if (!id) {
    throw new Error("connectionId is required.");
  }
  const payload = await invoke<unknown>("connection_columns", {
    connectionId: id,
    schema: schema.trim(),
    table: table.trim(),
  });
  if (!isConnectionColumnsResult(payload)) {
    throw new Error("Invalid connection columns payload from desktop bridge.");
  }
  return payload;
}

export async function bridgeListPackageMembers(
  connectionId: string,
  schema: string,
  packageName: string,
): Promise<ConnectionPackageMembersResult> {
  if (!isTauri()) {
    throw new Error("Database metadata is available in the desktop app only.");
  }
  const id = connectionId.trim();
  if (!id) {
    throw new Error("connectionId is required.");
  }
  const payload = await invoke<unknown>("connection_package_members", {
    connectionId: id,
    schema: schema.trim(),
    package: packageName.trim(),
  });
  if (!isConnectionPackageMembersResult(payload)) {
    throw new Error(
      "Invalid connection package members payload from desktop bridge.",
    );
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
  const payload = await invoke<unknown>("connection_rollback", {
    connectionId: id,
  });
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
  const payload = await invoke<unknown>("connection_set_catalog", {
    connectionId: id,
    catalog: name,
  });
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
