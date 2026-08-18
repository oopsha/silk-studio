import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  isConnectionPrimaryKeysResult,
  type ConnectionPrimaryKeysResult,
} from "@silk-studio/db-protocol";

export async function bridgeListPrimaryKeys(
  connectionId: string,
  schema: string | null | undefined,
  table: string,
  catalog?: string,
): Promise<ConnectionPrimaryKeysResult> {
  if (!isTauri()) {
    throw new Error("Database metadata is available in the desktop app only.");
  }
  const id = connectionId.trim();
  if (!id) {
    throw new Error("connectionId is required.");
  }
  const payload = await invoke<unknown>("connection_primary_keys", {
    connectionId: id,
    schema: schema?.trim() ?? "",
    table: table.trim(),
    catalog: catalog?.trim() ? catalog.trim() : null,
  });
  if (!isConnectionPrimaryKeysResult(payload)) {
    throw new Error("Invalid connection primary keys payload from desktop bridge.");
  }
  return payload;
}
