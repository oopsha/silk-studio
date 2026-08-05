import { EditorService } from "@silk-studio/editor/services/editor/editorService.ts";
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
  "You are Silk DB Studio's SQL assistant.",
  "Help with SQL, schemas, PL/SQL, and database questions for the user's connected database.",
  "Be concise and prefer dialect-correct SQL.",
  "Do not claim to have executed queries or changed data unless the user confirms an execution action in the app.",
  "When proposing SQL, put it in a fenced code block with language tag sql.",
  "When open PL/SQL dependency or column metadata is provided, treat it as factual DB metadata — do not invent references that are not listed.",
  "Compile-time dependencies may omit dynamic SQL (e.g. EXECUTE IMMEDIATE).",
  "When database tools are available, use them to look up object source, dependencies, and columns instead of guessing.",
  "You cannot write to the database or compile objects via tools — only read metadata and source.",
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
