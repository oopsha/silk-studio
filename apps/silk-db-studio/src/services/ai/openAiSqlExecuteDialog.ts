import type { QueryResultPayload } from "@silk-studio/db-protocol";
import { AiChatService } from "@silk-studio/workbench/services/ai/aiChatService.ts";
import { ConfigurationService } from "@silk-studio/workbench/platform/configuration/configurationService.ts";
import { GroupPanelStateService } from "@silk-studio/workbench/services/layout/groupPanelStateService.ts";
import { EditorGroupsService } from "@silk-studio/editor/services/editor/editorGroupsService.ts";
import {
  buildOpenDataOwnerId,
  QueryExecutionService,
} from "../query/queryExecutionService";
import { resolveExecutionConnectionId } from "../query/resolveExecutionConnection";
import { isWriteSql } from "../query/sqlGuard";
import { AiSqlExecuteDialogService } from "./aiSqlExecuteDialogService";

const SAMPLE_ROWS = 5;
const SAMPLE_CELL_CHARS = 40;

const IDENT = `(?:[\\w$#]+|"[^"]+"|\\[[^\\]]+\\])`;
const FROM_TABLE_PATTERN = new RegExp(
  `\\bfrom\\s+(${IDENT}(?:\\s*\\.\\s*${IDENT}){0,2})`,
  "i",
);
/** A bare "SELECT * FROM <table>" with no WHERE/JOIN/etc — same shape Explorer's Open Data emits. */
const OPEN_TABLE_SQL_PATTERN = new RegExp(
  `^select\\s+\\*\\s+from\\s+(${IDENT}(?:\\s*\\.\\s*${IDENT}){0,2})\\s*;?\\s*$`,
  "i",
);

function stripIdentQuotes(part: string): string {
  return part.trim().replace(/^["[]|["\]]$/g, "");
}

/** Best-effort tab title from the first FROM target, e.g. `SW_TRLOG.dbo.TRAN_LOG` -> `TRAN_LOG`. */
function deriveTabTitle(sql: string): string {
  const match = FROM_TABLE_PATTERN.exec(sql);
  if (!match) return "AI Proposal";
  const parts = match[1].split(".").map(stripIdentQuotes);
  return parts[parts.length - 1] || "AI Proposal";
}

type OpenTableTarget = { schemaName: string; objectName: string; label: string };

/**
 * When the proposed SQL is exactly "SELECT * FROM <table>", treat it as an
 * "open this table" request and route it through the same tab identity
 * (ownerId/relationKind) Explorer's double-click Open Data uses, instead of
 * a generic ad-hoc query result tab.
 */
function parseOpenTableSql(sql: string): OpenTableTarget | null {
  const match = OPEN_TABLE_SQL_PATTERN.exec(sql.trim());
  if (!match) return null;
  const parts = match[1].split(".").map(stripIdentQuotes);
  if (parts.some((part) => !part)) return null;
  const objectName = parts[parts.length - 1];
  const schemaName = parts.length >= 2 ? parts[parts.length - 2] : "";
  return { schemaName, objectName, label: parts.join(".") };
}

function buildWarnings(isWrite: boolean, readOnly: boolean): string[] {
  const warnings: string[] = [];
  if (isWrite) {
    warnings.push(
      "This looks like a write/DDL statement. An extra acknowledgement is required.",
    );
  }
  if (readOnly && isWrite) {
    warnings.push(
      "database.readOnly is enabled — this statement cannot be executed.",
    );
  } else if (readOnly) {
    warnings.push("database.readOnly is enabled. Writes remain blocked by the engine.");
  }
  warnings.push("Results appear in the panel; the chat will interpret the outcome.");
  return warnings;
}

function formatSampleRows(result: QueryResultPayload | null): string | null {
  if (!result || result.kind !== "resultSet") return null;
  if (result.columns.length === 0) return null;

  const lines: string[] = [
    `Columns: ${result.columns.join(", ")}`,
    `Sample rows (up to ${SAMPLE_ROWS}):`,
  ];
  const rows = result.rows.slice(0, SAMPLE_ROWS);
  if (rows.length === 0) {
    lines.push("(no rows)");
    return lines.join("\n");
  }

  for (let index = 0; index < rows.length; index += 1) {
    const cells = rows[index].map((cell) => {
      const text = cell === null ? "NULL" : String(cell);
      return text.length > SAMPLE_CELL_CHARS
        ? `${text.slice(0, SAMPLE_CELL_CHARS - 1)}…`
        : text;
    });
    lines.push(`${index + 1}. ${cells.join(" | ")}`);
  }
  if (result.truncated) {
    lines.push("(result truncated in the panel)");
  }
  return lines.join("\n");
}

function buildInterpretPrompt(params: {
  sql: string;
  status: string;
  output: string;
  sample: string | null;
}): string {
  const parts = [
    "I executed this AI-proposed SQL in Silk DB Studio after explicit confirmation.",
    "",
    `Status: ${params.status}`,
    `Outcome: ${params.output}`,
  ];
  if (params.sample) {
    parts.push("", params.sample);
  }
  parts.push(
    "",
    "SQL:",
    "```sql",
    params.sql.trim(),
    "```",
    "",
    "Please briefly interpret this outcome for me.",
    "If it failed, suggest a concise fix.",
    "Do not claim you executed the SQL yourself, and do not invent rows that are not shown.",
  );
  return parts.join("\n");
}

/**
 * Confirm, execute proposed SQL (never auto), then ask the chat to interpret.
 * Honors ai.allowExecute (caller) and database.readOnly (dialog + QueryExecutionService).
 */
export async function openAiSqlExecuteDialog(sql: string): Promise<boolean> {
  const trimmed = sql.trim();
  if (!trimmed) return false;

  if (!ConfigurationService.getValue("ai.allowExecute")) {
    AiChatService.appendLocalAssistantMessage(
      "SQL execution from AI Chat is disabled. Enable Allow SQL Execution in AI Settings, then try again. (Still requires confirmation — never auto-runs.)",
    );
    return false;
  }

  const isWrite = isWriteSql(trimmed);
  const readOnly = ConfigurationService.getValue("database.readOnly");
  const blockedReason =
    readOnly && isWrite
      ? "Read-only mode is enabled. Write/DDL statements cannot be executed."
      : null;

  const confirmed = await AiSqlExecuteDialogService.open({
    sql: trimmed,
    isWrite,
    readOnly,
    blockedReason,
    warnings: buildWarnings(isWrite, readOnly),
  });

  if (!confirmed) return false;

  const groupId = EditorGroupsService.getFocusedGroupId();
  GroupPanelStateService.showPanel(groupId);

  const openTableTarget = parseOpenTableSql(trimmed);
  let connectionId: string | null = null;
  if (openTableTarget) {
    try {
      connectionId = resolveExecutionConnectionId();
    } catch {
      connectionId = null;
    }
  }

  if (openTableTarget && connectionId) {
    await QueryExecutionService.execute(trimmed, {
      relationKind: "table",
      tabTitle: openTableTarget.label,
      connectionId,
      ownerId: buildOpenDataOwnerId(
        connectionId,
        openTableTarget.schemaName,
        openTableTarget.objectName,
      ),
    });
  } else {
    await QueryExecutionService.execute(trimmed, {
      tabTitle: deriveTabTitle(trimmed),
    });
  }

  const state = QueryExecutionService.getState(groupId);
  const sample = formatSampleRows(state.result);
  const prompt = buildInterpretPrompt({
    sql: trimmed,
    status: state.status,
    output: state.output,
    sample,
  });

  await AiChatService.interpretExecutionOutcome(prompt);
  return true;
}
