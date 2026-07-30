import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  isConnectionCompileResult,
  type ConnectionCompileResult,
  type MetadataObjectKind,
} from "@silk-studio/db-protocol";

export async function bridgeCompileObject(
  schema: string,
  name: string,
  kind: MetadataObjectKind,
  packageBody?: boolean,
): Promise<ConnectionCompileResult> {
  if (!isTauri()) {
    throw new Error("PL/SQL compile is available in the desktop app only.");
  }
  const payload = await invoke<unknown>("connection_compile", {
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
