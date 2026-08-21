import { isTauri } from "@tauri-apps/api/core";
import { invokeJdbcCommand } from "./jdbcInvoke";
import {
  isConnectionDependenciesResult,
  isConnectionDependentsResult,
  type ConnectionDependenciesResult,
  type ConnectionDependentsResult,
  type MetadataObjectKind,
} from "@silk-studio/db-protocol";

export async function bridgeListObjectDependencies(
  connectionId: string,
  schema: string,
  name: string,
  kind: MetadataObjectKind,
  packageBody?: boolean,
  catalog?: string,
): Promise<ConnectionDependenciesResult> {
  if (!isTauri()) {
    throw new Error("Object dependencies are available in the desktop app only.");
  }
  const id = connectionId.trim();
  if (!id) {
    throw new Error("connectionId is required.");
  }
  const payload = await invokeJdbcCommand<unknown>(
    "connection_dependencies",
    {
      connectionId: id,
      schema: schema.trim(),
      name: name.trim(),
      kind,
      packageBody,
      catalog: catalog?.trim() ? catalog.trim() : null,
    },
    id,
  );
  if (!isConnectionDependenciesResult(payload)) {
    throw new Error("Invalid connection dependencies payload from desktop bridge.");
  }
  return payload;
}

/** Reverse of {@link bridgeListObjectDependencies} — objects that reference this one. */
export async function bridgeListObjectDependents(
  connectionId: string,
  schema: string,
  name: string,
  kind: MetadataObjectKind,
  packageBody?: boolean,
  catalog?: string,
): Promise<ConnectionDependentsResult> {
  if (!isTauri()) {
    throw new Error("Object dependents are available in the desktop app only.");
  }
  const id = connectionId.trim();
  if (!id) {
    throw new Error("connectionId is required.");
  }
  const payload = await invokeJdbcCommand<unknown>(
    "connection_dependents",
    {
      connectionId: id,
      schema: schema.trim(),
      name: name.trim(),
      kind,
      packageBody,
      catalog: catalog?.trim() ? catalog.trim() : null,
    },
    id,
  );
  if (!isConnectionDependentsResult(payload)) {
    throw new Error("Invalid connection dependents payload from desktop bridge.");
  }
  return payload;
}
