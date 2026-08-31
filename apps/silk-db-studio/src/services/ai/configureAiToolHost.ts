import type { MetadataObjectKind } from "@silk-studio/db-protocol";
import { configureAiToolHost } from "@silk-studio/workbench/services/ai/aiToolHost.ts";
import { AI_DB_TOOL_DEFINITIONS } from "@silk-studio/workbench/services/ai/aiToolDefinitions.ts";
import {
  SILK_USAGE_GUIDE_TOOL,
  getSilkUsageGuideText,
} from "@silk-studio/workbench/services/ai/silkUsageGuide.ts";
import { bridgeListColumns } from "../connection/connectionBridge";
import { bridgeListObjectDependencies } from "../connection/connectionDependenciesBridge";
import { bridgeFetchObjectDdl } from "../connection/connectionDdlBridge";
import { ConnectionService } from "../connection/connectionService";
import { EditorConnectionBindingService } from "../connection/editorConnectionBindingService";
import { openObjectEditor } from "../connection/objectEditorService";
import { bridgeFindObjectsByName } from "../connection/connectionBridge";

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

/**
 * Resolves which connection a tool call targets: an explicit `args.connectionName` (from
 * find_object_by_name's matches, or the Explorer's connection display name) when given,
 * otherwise the old implicit single-connection guess. Throws (caught by executeTool's try/
 * catch) rather than returning early — every profile-scoped tool case calls this first.
 */
function resolveProfileIdFromArgs(args: Record<string, unknown>): string {
  const connectionName =
    typeof args.connectionName === "string" ? args.connectionName.trim() : "";
  if (connectionName) {
    const profile = ConnectionService.getConnectedProfiles().find(
      (candidate) => candidate.name === connectionName,
    );
    if (!profile) {
      throw new Error(
        `No connected profile named "${connectionName}". Connected profiles: ${ConnectionService.getConnectedProfiles()
          .map((candidate) => candidate.name)
          .join(", ") || "(none)"}.`,
      );
    }
    return profile.id;
  }
  const profileId = resolveToolProfileId();
  if (!profileId) {
    throw new Error("Connect a database profile before using DB tools.");
  }
  return profileId;
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

/** SQL Server only — `dbo` (etc.) exists identically in every database on a connection, so
 *  omitting this when it matters silently targets whichever database happens to be current. */
function resolveCatalogNameFromArgs(args: Record<string, unknown>): string | undefined {
  const catalogName = typeof args.catalogName === "string" ? args.catalogName.trim() : "";
  return catalogName || undefined;
}

async function executeTool(
  name: string,
  argsJson: string,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) {
    throw new Error("Cancelled.");
  }

  const args = parseArgs(argsJson);

  try {
    switch (name) {
      case "get_plsql_source":
      case "get_object_ddl": {
        const profileId = resolveProfileIdFromArgs(args);
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
          resolveCatalogNameFromArgs(args),
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
        const profileId = resolveProfileIdFromArgs(args);
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
          resolveCatalogNameFromArgs(args),
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
        const profileId = resolveProfileIdFromArgs(args);
        const schema = requireString(args, "schema");
        const table = requireString(args, "table");
        const result = await bridgeListColumns(
          profileId,
          schema,
          table,
          resolveCatalogNameFromArgs(args),
        );
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
      case "find_object_by_name": {
        const objectName = requireString(args, "name");
        const profiles = ConnectionService.getConnectedProfiles();
        if (profiles.length === 0) {
          throw new Error("Connect a database profile before using DB tools.");
        }
        const matches: Array<{
          connectionName: string;
          catalogName?: string;
          schemaName: string;
          name: string;
          kind: string;
        }> = [];
        for (const profile of profiles) {
          try {
            const result = await bridgeFindObjectsByName(profile.id, objectName);
            for (const object of result.objects) {
              matches.push({ connectionName: profile.name, ...object });
            }
          } catch {
            // Best-effort across connections — one profile failing to search (e.g. a transient
            // connection hiccup) shouldn't fail the search on every other connected profile.
          }
        }
        return truncate(
          JSON.stringify({ name: objectName, matches }),
          MAX_RESULT_CHARS,
        );
      }
      case "open_object_editor": {
        const schema = requireString(args, "schema");
        const objectName = requireString(args, "name");
        const kind = asObjectKind(args.kind);
        if (!kind) {
          throw new Error(
            "kind must be table|view|procedure|function|package",
          );
        }
        const connectionName =
          typeof args.connectionName === "string" ? args.connectionName.trim() : "";
        const catalogName = resolveCatalogNameFromArgs(args);
        const profileId = resolveProfileIdFromArgs(args);
        openObjectEditor({
          profileId,
          schemaName: schema,
          object: { name: objectName, kind },
          catalogName,
        });
        return JSON.stringify({
          opened: true,
          connectionName: connectionName || undefined,
          catalogName,
          schema,
          name: objectName,
          kind,
          note: "Properties tab opened. No query was run — the Data tab (if any) is still empty until the user opens it or you propose a SELECT.",
        });
      }
      case "get_silk_usage_guide": {
        const topic =
          typeof args.topic === "string" ? args.topic.trim() : undefined;
        return getSilkUsageGuideText(topic);
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
      const dbTools = profileId ? AI_DB_TOOL_DEFINITIONS : [];
      // Usage-guide lookup has no connection dependency — offer it even with nothing connected,
      // since "how do I create a connection" is exactly the question a brand-new user would ask.
      return [...dbTools, SILK_USAGE_GUIDE_TOOL];
    },
    executeTool,
  });
}
