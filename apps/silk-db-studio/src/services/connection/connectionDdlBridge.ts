import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  isConnectionDdlResult,
  type ConnectionDdlResult,
  type MetadataObjectKind,
} from "@silk-studio/db-protocol";

export async function bridgeFetchObjectDdl(
  schema: string,
  name: string,
  kind: MetadataObjectKind,
  packageBody?: boolean,
): Promise<ConnectionDdlResult> {
  if (!isTauri()) {
    throw new Error("DDL metadata is available in the desktop app only.");
  }
  const payload = await invoke<unknown>("connection_ddl", {
    schema: schema.trim(),
    name: name.trim(),
    kind,
    packageBody,
  });
  if (!isConnectionDdlResult(payload)) {
    throw new Error("Invalid connection DDL payload from desktop bridge.");
  }
  return payload;
}
