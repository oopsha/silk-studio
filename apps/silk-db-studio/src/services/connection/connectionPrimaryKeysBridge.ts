import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  isConnectionPrimaryKeysResult,
  type ConnectionPrimaryKeysResult,
} from "@silk-studio/db-protocol";

export async function bridgeListPrimaryKeys(
  schema: string | null | undefined,
  table: string,
): Promise<ConnectionPrimaryKeysResult> {
  if (!isTauri()) {
    throw new Error("Database metadata is available in the desktop app only.");
  }
  const payload = await invoke<unknown>("connection_primary_keys", {
    schema: schema?.trim() ?? "",
    table: table.trim(),
  });
  if (!isConnectionPrimaryKeysResult(payload)) {
    throw new Error("Invalid connection primary keys payload from desktop bridge.");
  }
  return payload;
}
