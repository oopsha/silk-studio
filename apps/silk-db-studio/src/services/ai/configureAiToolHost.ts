import type { MetadataObjectKind } from "@silk-studio/db-protocol";
import { configureAiToolHost } from "@silk-studio/workbench/services/ai/aiToolHost.ts";
import { AI_DB_TOOL_DEFINITIONS } from "@silk-studio/workbench/services/ai/aiToolDefinitions.ts";
import { bridgeListColumns } from "../connection/connectionBridge";
import { bridgeListObjectDependencies } from "../connection/connectionDependenciesBridge";
import { bridgeFetchObjectDdl } from "../connection/connectionDdlBridge";
import { ConnectionService } from "../connection/connectionService";
import { EditorConnectionBindingService } from "../connection/editorConnectionBindingService";

const MAX_RESULT_CHARS = 14_000;
const MAX_SOURCE_CHARS = 10_000;
const MAX_COLUMNS = 80;

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}

function resolveToolProfileId(): string | null {
  const bindingId =
    EditorConnectionBindingService.getActiveBinding().profileId?.trim() || null;
  if (bindingId && ConnectionService.isConnected(bindingId)) {
    return bindingId;
  }
  const connected = ConnectionService.getConnectedProfile();
  return connected && ConnectionService.isConnected(connected.id)
    ? connected.id
    : null;
}

function asObjectKind(value: unknown): MetadataObjectKind | null {
  if (
    value === "table" ||
    value === "view" ||
    value === "procedure" ||
    value === "function" ||
    value === "package"
  ) {
    return value;
  }
  return null;
}

function parseArgs(argsJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(argsJson || "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function requireString(
  args: Record<string, unknown>,
  key: string,
): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing or invalid argument: ${key}`);
  }
  return value.trim();
}

async function executeTool(
  name: string,
  argsJson: string,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) {
    throw new Error("Cancelled.");
  }

  const profileId = resolveToolProfileId();
  if (!profileId) {
    return JSON.stringify({
      error: "Connect a database profile before using DB tools.",
    });
  }

  const args = parseArgs(argsJson);

  try {
    switch (name) {
      case "get_plsql_source":
      case "get_object_ddl": {
        const schema = requireString(args, "schema");
        const objectName = requireString(args, "name");
        const kind = asObjectKind(args.kind);
        if (!kind) {
          throw new Error("kind must be table|view|procedure|function|package");
        }
        if (
          name === "get_plsql_source" &&
          kind !== "procedure" &&
          kind !== "function" &&
          kind !== "package"
        ) {
          throw new Error(
            "get_plsql_source only supports procedure, function, package",
          );
        }
        const packageBody =
          kind === "package" && typeof args.packageBody === "boolean"
            ? args.packageBody
            : undefined;
        const result = await bridgeFetchObjectDdl(
          profileId,
          schema,
          objectName,
          kind,
          packageBody,
        );
        return truncate(
          JSON.stringify({
            dialectId: result.dialectId,
            schema,
            name: objectName,
            kind,
            packageBody: packageBody ?? false,
            ddl: truncate(result.ddl, MAX_SOURCE_CHARS),
          }),
          MAX_RESULT_CHARS,
        );
      }
      case "list_object_dependencies": {
        const schema = requireString(args, "schema");
        const objectName = requireString(args, "name");
        const kind = asObjectKind(args.kind);
        if (
          kind !== "procedure" &&
          kind !== "function" &&
          kind !== "package"
        ) {
          throw new Error(
            "kind must be procedure, function, or package for dependencies",
          );
        }
        const packageBody =
          kind === "package" && typeof args.packageBody === "boolean"
            ? args.packageBody
            : undefined;
        const result = await bridgeListObjectDependencies(
          profileId,
          schema,
          objectName,
          kind,
          packageBody,
        );
        return truncate(
          JSON.stringify({
            dialectId: result.dialectId,
            schema,
            name: objectName,
            kind,
            packageBody: packageBody ?? false,
            dependencies: result.dependencies,
          }),
          MAX_RESULT_CHARS,
        );
      }
      case "get_table_columns": {
        const schema = requireString(args, "schema");
        const table = requireString(args, "table");
        const result = await bridgeListColumns(profileId, schema, table);
        const columns = result.columns.slice(0, MAX_COLUMNS).map((col) => ({
          name: col.name,
          typeName: col.typeName,
        }));
        return truncate(
          JSON.stringify({
            schema,
            table,
            columns,
            omitted:
              result.columns.length > MAX_COLUMNS
                ? result.columns.length - MAX_COLUMNS
                : 0,
          }),
          MAX_RESULT_CHARS,
        );
      }
      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (error) {
    return JSON.stringify({
      error: error instanceof Error ? error.message : "Tool failed.",
    });
  }
}

/** Wire read-only DB tools into the workbench AI tool host. */
export function configureDbStudioAiToolHost(): void {
  configureAiToolHost({
    getTools: () => {
      const profileId = resolveToolProfileId();
      if (!profileId) return [];
      return [...AI_DB_TOOL_DEFINITIONS];
    },
    executeTool,
  });
}
