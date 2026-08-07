import { EditorService } from "@silk-studio/editor/services/editor/editorServiceFacade.ts";
import { LayoutService } from "@silk-studio/workbench/services/layout/layoutService.ts";
import { EditorConnectionBindingService } from "../connection/editorConnectionBindingService";
import { resolveActiveMonacoLanguageId } from "../sql/sqlDialect";
import { QueryExecutionService } from "./queryExecutionService";

/** Open SQL in a new untitled editor tab. */
export function openSqlInEditor(sql: string, label?: string): void {
  const content = sql.endsWith("\n") ? sql : `${sql}\n`;
  const tabId = EditorService.openEditor({
    label: label?.trim() || `Query-${Date.now().toString().slice(-6)}`,
    languageId: resolveActiveMonacoLanguageId(),
    content,
    preview: false,
  });
  EditorConnectionBindingService.ensureBinding(tabId);
}

/** Insert SQL at the active editor cursor (or replace selection). */
export function insertSqlIntoActiveEditor(sql: string): void {
  const text = sql.trim();
  if (!text) return;

  const snapshot = EditorService.getActiveEditorSnapshot();
  const tab = EditorService.getActiveTab();
  if (!tab || tab.uri?.startsWith("silk://")) {
    openSqlInEditor(text);
    return;
  }

  const instance = EditorService.getActiveTextEditor();
  const model = instance?.getModel();
  if (instance && model && snapshot) {
    const start = model.getPositionAt(snapshot.selectionStart);
    const end = model.getPositionAt(snapshot.selectionEnd);
    instance.pushUndoStop();
    instance.executeEdits("silk.query.insert", [
      {
        range: {
          startLineNumber: start.lineNumber,
          startColumn: start.column,
          endLineNumber: end.lineNumber,
          endColumn: end.column,
        },
        text,
      },
    ]);
    instance.pushUndoStop();
    return;
  }

  if (!snapshot) {
    EditorService.updateTabContent(tab.id, text);
    return;
  }

  const next =
    snapshot.content.slice(0, snapshot.selectionStart) +
    text +
    snapshot.content.slice(snapshot.selectionEnd);
  EditorService.updateTabContent(tab.id, next);
}

export async function reexecuteSql(sql: string): Promise<void> {
  LayoutService.showPanel();
  await QueryExecutionService.execute(sql);
}
