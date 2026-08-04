import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  isConnectionCompileResult,
  type ConnectionCompileResult,
  type MetadataObjectKind,
} from "@silk-studio/db-protocol";

export async function bridgeCompileObject(
  connectionId: string,
  schema: string,
  name: string,
  kind: MetadataObjectKind,
  packageBody?: boolean,
): Promise<ConnectionCompileResult> {
  if (!isTauri()) {
    throw new Error("PL/SQL compile is available in the desktop app only.");
  }
  const id = connectionId.trim();
  if (!id) {
    throw new Error("connectionId is required.");
  }
  const payload = await invoke<unknown>("connection_compile", {
    connectionId: id,
    schema: schema.trim(),
    name: name.trim(),
    kind,
    packageBody,
  });
  if (!isConnectionCompileResult(payload)) {
    throw new Error("Invalid connection compile payload from desktop bridge.");
  }
  return payload;
}
