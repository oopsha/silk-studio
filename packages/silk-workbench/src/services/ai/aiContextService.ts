import { EditorService } from "@silk-studio/editor/services/editor/editorServiceFacade.ts";
import { ConfigurationService } from "../../platform/configuration/configurationService";
import { AiContextHost } from "./aiContextHost";

const LIMITS = {
  totalChars: 20_000,
  schemaChars: 6_000,
  selectionChars: 8_000,
  historyChars: 4_000,
  historyEntries: 8,
  plsqlChars: 8_000,
} as const;

const BASE_SYSTEM_PROMPT = [
  "You are Silk DB Studio's assistant.",
  "Help with two kinds of questions: (1) SQL, schemas, PL/SQL, and database questions for the user's connected database, and (2) how to use Silk DB Studio itself (connections/tunnels, the Explorer and search, object editors, running/organizing SQL, query results and history, transactions, this chat's own settings, general app Settings/theme/diagnostics). For (2), call the get_silk_usage_guide tool rather than guessing menu names or shortcuts from general knowledge — it's available even before any database is connected.",
  "Be concise and prefer dialect-correct SQL.",
  "Do not claim to have executed queries or changed data unless the user confirms an execution action in the app.",
  "When proposing SQL, put it in a fenced code block with language tag sql.",
  "When open PL/SQL dependency or column metadata is provided, treat it as factual DB metadata — do not invent references that are not listed.",
  "Compile-time dependencies may omit dynamic SQL (e.g. EXECUTE IMMEDIATE).",
  "When database tools are available, use them to look up object source, dependencies, and columns instead of guessing.",
  "If the user names a table/view but you don't know (or aren't sure) which schema it's in, call find_object_by_name first rather than guessing a schema. It searches every connected profile, not just the currently active one — each match includes a connectionName. If it returns more than one match (a different connection and/or schema each), ask the user which one they mean before doing anything else with it, rather than picking one yourself.",
  "When more than one database profile is connected, always pass connectionName (from find_object_by_name's match, or the Explorer's connection label) to get_plsql_source/get_object_ddl/list_object_dependencies/get_table_columns/open_object_editor. Omitting it falls back to whichever connection happens to be active in the editor, which is frequently the wrong one when several are connected — do not omit it just because the user only named the object, not the connection.",
  "On SQL Server connections, also pass catalogName (from find_object_by_name's match) to those same tools whenever it's present. SQL Server has one dbo schema per database, so without catalogName the tool may target the wrong database and silently return nothing (e.g. an empty column list) even though the object exists — this is not the same failure as a wrong connectionName, and omitting catalogName is a common way to get a confusing empty result on SQL Server specifically.",
  "You cannot write to the database or compile objects via tools — only read metadata and source.",
  "When the user asks you to open an object's editor tab (a table, view, procedure, function, or package), call the open_object_editor tool for each one. This runs no query — it just opens the tab on its Properties view (columns/DDL from metadata already fetched). It does not populate the Data tab.",
  "After a plain 'open this tab' request, stop there — do not also propose SELECT blocks unless the user actually asked to see row data (words like 'data', 'rows', 'contents', or a follow-up asking to see what's inside). Opening a tab and viewing its rows are two different asks; don't bundle the second one in uninvited just because it's possible.",
  "Only when the user does want to see a table/view's rows: propose a bare `SELECT * FROM <table>` — nothing else in that statement, no WHERE/JOIN/columns/alias — as its own fenced sql block; the user clicks Execute on that block to run it and open/fill that table's Data tab.",
  "To do this for multiple tables, propose one such bare SELECT block per table (one table per block, each block containing only that single statement) — each block gets its own Execute button.",
  "For SQL Server, a three-part reference like database.schema.table is valid inside that single SELECT and does not require switching the connection's current database.",
].join(" ");

function truncateText(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxChars - 1))}…`;
}

function buildSelectionBlock(maxChars: number): string | null {
  const tab = EditorService.getActiveTab();
  const snapshot = EditorService.getActiveEditorSnapshot();
  if (!tab || !snapshot) return null;

  const { content, selectionStart, selectionEnd } = snapshot;
  const hasSelection = selectionEnd > selectionStart;
  const raw = hasSelection
    ? content.slice(selectionStart, selectionEnd)
    : content;
  if (!raw.trim()) return null;

  const truncated = truncateText(raw, maxChars);
  const scope = hasSelection ? "selection" : "entire buffer";
  const language = tab.languageId || "plaintext";
  return [
    `### Active editor (${scope}, language=${language}, tab=${tab.label})`,
    "```" + language,
    truncated,
    "```",
  ].join("\n");
}

function buildConnectionBlock(): string | null {
  const connection = AiContextHost.getConnectionContext();
  if (!connection) return null;

  if (!connection.connected) {
    return "### Connection\nNot connected.";
  }

  const lines = [
    "### Connection",
    `- Profile: ${connection.profileName ?? "(unknown)"}`,
    `- Dialect: ${connection.dialectLabel ?? connection.driverId ?? "(unknown)"}`,
  ];
  if (connection.catalog?.trim()) {
    lines.push(`- Catalog/Database: ${connection.catalog.trim()}`);
  }
  if (connection.defaultSchema?.trim()) {
    lines.push(`- Default schema: ${connection.defaultSchema.trim()}`);
  }
  return lines.join("\n");
}

/**
 * Assemble the system message for an AI chat request based on settings flags.
 * Schema / history / PL/SQL deps come from the app host; selection from the editor.
 */
export async function buildAiSystemPrompt(): Promise<string> {
  const includeSchema = ConfigurationService.getValue(
    "ai.context.includeSchema",
  );
  const includeSelection = ConfigurationService.getValue(
    "ai.context.includeSelection",
  );
  const includeHistory = ConfigurationService.getValue(
    "ai.context.includeQueryHistory",
  );
  const includePlsqlDeps = ConfigurationService.getValue(
    "ai.context.includePlsqlDeps",
  );

  const sections: string[] = [BASE_SYSTEM_PROMPT];

  const connection = buildConnectionBlock();
  if (connection) {
    sections.push(connection);
  }

  const connectionMeta = AiContextHost.getConnectionContext();
  if (connectionMeta?.dialectLabel) {
    sections.push(
      `### Dialect guidance\nPrefer ${connectionMeta.dialectLabel} SQL syntax and object naming.`,
    );
  }

  if (includeSchema) {
    const schema = AiContextHost.getSchemaSummaryText(LIMITS.schemaChars);
    if (schema) {
      sections.push(`### Schema summary\n${schema}`);
    } else if (connectionMeta?.connected) {
      sections.push(
        "### Schema summary\nNo cached Explorer metadata yet. Expand schemas/tables in Explorer to enrich context.",
      );
    }
  }

  if (includeSelection) {
    const selection = buildSelectionBlock(LIMITS.selectionChars);
    if (selection) {
      sections.push(selection);
    }
  }

  if (includePlsqlDeps) {
    const plsql = await AiContextHost.getOpenPlsqlContextText(LIMITS.plsqlChars);
    if (plsql) {
      sections.push(plsql);
    }
  }

  if (includeHistory) {
    const history = AiContextHost.getRecentQueryHistoryText(
      LIMITS.historyChars,
      LIMITS.historyEntries,
    );
    if (history) {
      sections.push(`### Recent query history\n${history}`);
    }
  }

  return truncateText(sections.join("\n\n"), LIMITS.totalChars);
}

/** Test helper: which context sections would be included for current flags. */
export function getAiContextFlags() {
  return {
    includeSchema: ConfigurationService.getValue("ai.context.includeSchema"),
    includeSelection: ConfigurationService.getValue(
      "ai.context.includeSelection",
    ),
    includeQueryHistory: ConfigurationService.getValue(
      "ai.context.includeQueryHistory",
    ),
    includePlsqlDeps: ConfigurationService.getValue(
      "ai.context.includePlsqlDeps",
    ),
  };
}
