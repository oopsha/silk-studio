import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  isConnectionMetadataResult,
  type ConnectionCredentials,
  type ConnectionMetadataResult,
} from "@silk-studio/db-protocol";

export async function bridgeConnect(
  credentials: ConnectionCredentials,
): Promise<void> {
  if (!isTauri()) {
    throw new Error("Database connections are available in the desktop app only.");
  }
  await invoke("connection_connect", {
    url: credentials.url,
    user: credentials.user,
    password: credentials.password,
    schema: credentials.schema?.trim() ? credentials.schema.trim() : null,
    catalog: credentials.catalog?.trim() ? credentials.catalog.trim() : null,
  });
}

export async function bridgeDisconnect(): Promise<void> {
  if (!isTauri()) return;
  await invoke("connection_disconnect");
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
  schema?: string,
): Promise<ConnectionMetadataResult> {
  if (!isTauri()) {
    throw new Error("Database metadata is available in the desktop app only.");
  }
  const payload = await invoke<unknown>("connection_metadata", {
    schema: schema?.trim() ? schema.trim() : null,
  });
  if (!isConnectionMetadataResult(payload)) {
    throw new Error("Invalid connection metadata payload from desktop bridge.");
  }
  return payload;
}
