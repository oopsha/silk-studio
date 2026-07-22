import { format } from "sql-formatter";
import { ConfigurationService } from "@silk-studio/workbench/platform/configuration/configurationService.ts";
import { EditorService } from "@silk-studio/editor/services/editor/editorService.ts";
import {
  formatterLanguageForDriver,
  isSqlLanguageId,
  resolveActiveDriverId,
  type SqlMonacoLanguageId,
} from "./sqlDialect";

export type SqlFormatOptions = {
  tabSize: number;
  insertSpaces: boolean;
};

export function getSqlFormatOptionsFromSettings(): SqlFormatOptions {
  return {
    tabSize: ConfigurationService.getValue("editor.tabSize"),
    insertSpaces: ConfigurationService.getValue("editor.insertSpaces"),
  };
}

export function formatSqlText(
  sql: string,
  options: SqlFormatOptions = getSqlFormatOptionsFromSettings(),
): string {
  const driverId = resolveActiveDriverId();
  return format(sql, {
    language: formatterLanguageForDriver(driverId),
    tabWidth: options.tabSize,
    useTabs: !options.insertSpaces,
    keywordCase: "upper",
  });
}

function applyTextEdit(startOffset: number, endOffset: number, text: string): void {
  const instance = EditorService.getActiveTextEditor();
  const model = instance?.getModel();
  if (instance && model) {
    const range = {
      startLineNumber: model.getPositionAt(startOffset).lineNumber,
      startColumn: model.getPositionAt(startOffset).column,
      endLineNumber: model.getPositionAt(endOffset).lineNumber,
      endColumn: model.getPositionAt(endOffset).column,
    };
    instance.pushUndoStop();
    instance.executeEdits("silk.sql.format", [{ range, text }]);
    instance.pushUndoStop();
    return;
  }

  const tab = EditorService.getActiveTab();
  if (!tab) return;
  const next =
    tab.content.slice(0, startOffset) + text + tab.content.slice(endOffset);
  EditorService.updateTabContent(tab.id, next);
}

function activeTabIsSql(): boolean {
  const tab = EditorService.getActiveTab();
  return Boolean(tab && isSqlLanguageId(tab.languageId));
}

export function formatActiveSqlDocument(): boolean {
  if (!activeTabIsSql()) return false;

  const snapshot = EditorService.getActiveEditorSnapshot();
  if (!snapshot) return false;

  try {
    const formatted = formatSqlText(snapshot.content);
    if (formatted === snapshot.content) return true;
    applyTextEdit(0, snapshot.content.length, formatted);
    return true;
  } catch (error) {
    console.warn("[silk.sql.formatDocument] format failed", error);
    return false;
  }
}

export function formatActiveSqlSelection(): boolean {
  if (!activeTabIsSql()) return false;

  const snapshot = EditorService.getActiveEditorSnapshot();
  if (!snapshot) return false;

  const { selectionStart, selectionEnd, content } = snapshot;
  if (selectionStart === selectionEnd) return false;

  const selected = content.slice(selectionStart, selectionEnd);
  try {
    const formatted = formatSqlText(selected);
    if (formatted === selected) return true;
    applyTextEdit(selectionStart, selectionEnd, formatted);
    return true;
  } catch (error) {
    console.warn("[silk.sql.formatSelection] format failed", error);
    return false;
  }
}

/** Exported for tests / status display. */
export function languageIdSupportsFormat(
  languageId: string,
): languageId is SqlMonacoLanguageId {
  return isSqlLanguageId(languageId);
}
