import { isTauri } from "@tauri-apps/api/core";
import { invokeJdbcCommand } from "./jdbcInvoke";
import {
  isConnectionArgumentsResult,
  type ConnectionArgumentsResult,
} from "@silk-studio/db-protocol";

/**
 * Parameter list for a standalone stored procedure/function (not a package member) — Object
 * Editor "Arguments" section. See `connection.arguments` in jdbc-agent's `Main.java`.
 */
export async function bridgeListArguments(
  connectionId: string,
  schema: string,
  name: string,
  kind: "procedure" | "function",
  catalog?: string,
): Promise<ConnectionArgumentsResult> {
  if (!isTauri()) {
    throw new Error("Object arguments are available in the desktop app only.");
  }
  const id = connectionId.trim();
  if (!id) {
    throw new Error("connectionId is required.");
  }
  const payload = await invokeJdbcCommand<unknown>(
    "connection_arguments",
    {
      connectionId: id,
      schema: schema.trim(),
      name: name.trim(),
      kind,
      catalog: catalog?.trim() ? catalog.trim() : null,
    },
    id,
  );
  if (!isConnectionArgumentsResult(payload)) {
    throw new Error("Invalid connection arguments payload from desktop bridge.");
  }
  return payload;
}
