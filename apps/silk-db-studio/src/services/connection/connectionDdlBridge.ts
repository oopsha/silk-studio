import { isTauri } from "@tauri-apps/api/core";
import { invokeJdbcCommand } from "./jdbcInvoke";
import {
  isConnectionDdlResult,
  type ConnectionDdlResult,
  type MetadataObjectKind,
} from "@silk-studio/db-protocol";

export async function bridgeFetchObjectDdl(
  connectionId: string,
  schema: string,
  name: string,
  kind: MetadataObjectKind,
  packageBody?: boolean,
  catalog?: string,
): Promise<ConnectionDdlResult> {
  if (!isTauri()) {
    throw new Error("DDL metadata is available in the desktop app only.");
  }
  const id = connectionId.trim();
  if (!id) {
    throw new Error("connectionId is required.");
  }
  const payload = await invokeJdbcCommand<unknown>(
    "connection_ddl",
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
  if (!isConnectionDdlResult(payload)) {
    throw new Error("Invalid connection DDL payload from desktop bridge.");
  }
  return payload;
}
