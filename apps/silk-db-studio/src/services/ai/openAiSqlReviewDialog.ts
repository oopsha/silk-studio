import { EditorService } from "@silk-studio/editor/services/editor/editorService.ts";
import { ConfigurationService } from "@silk-studio/workbench/platform/configuration/configurationService.ts";
import { resolveActiveMonacoLanguageId } from "../sql/sqlDialect";
import {
  insertSqlIntoActiveEditor,
  openSqlInEditor,
} from "../query/querySqlActions";
import { isWriteSql } from "../query/sqlGuard";
import {
  AiSqlDiffDialogService,
  type AiSqlReviewAction,
} from "./aiSqlDiffDialogService";

function buildOriginalSnapshot(): {
  original: string;
  originalLabel: string;
} {
  const snapshot = EditorService.getActiveEditorSnapshot();
  const tab = EditorService.getActiveTab();
  if (!snapshot || !tab || tab.uri?.startsWith("silk://")) {
    return {
      original: "",
      originalLabel: "No active SQL editor (Insert opens a new tab)",
    };
  }

  const hasSelection = snapshot.selectionEnd > snapshot.selectionStart;
  if (hasSelection) {
    return {
      original: snapshot.content.slice(
        snapshot.selectionStart,
        snapshot.selectionEnd,
      ),
      originalLabel: `Selection in ${tab.label}`,
    };
  }

  return {
    original: snapshot.content,
    originalLabel: `Buffer: ${tab.label}`,
  };
}

function buildWarnings(sql: string): string[] {
  const warnings: string[] = [];
  if (isWriteSql(sql)) {
    warnings.push(
      "This looks like a write/DDL statement. Review carefully before inserting.",
    );
  }
  if (ConfigurationService.getValue("database.readOnly") && isWriteSql(sql)) {
    warnings.push(
      "database.readOnly is enabled. Inserting is allowed, but running this SQL later will be blocked.",
    );
  }
  warnings.push("SQL is never executed from this review.");
  return warnings;
}

/**
 * Open the AI SQL review dialog. Applies editor changes only after confirm.
 * Never executes SQL against the database.
 */
export async function openAiSqlReviewDialog(sql: string): Promise<boolean> {
  const trimmed = sql.trim();
  if (!trimmed) return false;

  const { original, originalLabel } = buildOriginalSnapshot();
  const action = await AiSqlDiffDialogService.open({
    sql: trimmed,
    original,
    originalLabel,
    warnings: buildWarnings(trimmed),
    languageId: resolveActiveMonacoLanguageId(),
  });

  if (action === "cancel") return false;

  if (action === "newTab") {
    openSqlInEditor(trimmed, "AI Proposal");
  } else {
    insertSqlIntoActiveEditor(trimmed);
  }
  return true;
}

export type { AiSqlReviewAction };
