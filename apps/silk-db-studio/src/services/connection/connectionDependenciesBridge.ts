import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  isConnectionDependenciesResult,
  type ConnectionDependenciesResult,
  type MetadataObjectKind,
} from "@silk-studio/db-protocol";

export async function bridgeListObjectDependencies(
  connectionId: string,
  schema: string,
  name: string,
  kind: MetadataObjectKind,
  packageBody?: boolean,
): Promise<ConnectionDependenciesResult> {
  if (!isTauri()) {
    throw new Error("Object dependencies are available in the desktop app only.");
  }
  const id = connectionId.trim();
  if (!id) {
    throw new Error("connectionId is required.");
  }
  const payload = await invoke<unknown>("connection_dependencies", {
    connectionId: id,
    schema: schema.trim(),
    name: name.trim(),
    kind,
    packageBody,
  });
  if (!isConnectionDependenciesResult(payload)) {
    throw new Error("Invalid connection dependencies payload from desktop bridge.");
  }
  return payload;
}
