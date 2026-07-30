import { editor, MarkerSeverity } from "monaco-editor";
import type { ConnectionCompileError } from "@silk-studio/db-protocol";
import { EditorService } from "@silk-studio/editor/services/editor/editorService.ts";

export const PLSQL_COMPILE_MARKER_OWNER = "silk.plsql.compile";

export function clearPlsqlCompileMarkers(
  model?: editor.ITextModel | null,
): void {
  const target = model ?? EditorService.getActiveTextEditor()?.getModel();
  if (!target) return;
  editor.setModelMarkers(target, PLSQL_COMPILE_MARKER_OWNER, []);
}

/**
 * Maps ALL_ERRORS line/column onto the Monaco model (1-based → Monaco).
 * Clamps out-of-range positions to the end of the document.
 */
export function applyPlsqlCompileMarkers(
  errors: ConnectionCompileError[],
  model?: editor.ITextModel | null,
): void {
  const textEditor = EditorService.getActiveTextEditor();
  const target = model ?? textEditor?.getModel();
  if (!target) return;

  const lineCount = target.getLineCount();
  const markers: editor.IMarkerData[] = errors.map((item) => {
    const line = clamp(item.line, 1, Math.max(1, lineCount));
    const maxColumn = target.getLineMaxColumn(line);
    const column = clamp(item.column, 1, maxColumn);
    const endColumn = Math.min(maxColumn, column + 1);
    const isWarning = (item.attribute ?? "").toUpperCase() === "WARNING";
    return {
      severity: isWarning ? MarkerSeverity.Warning : MarkerSeverity.Error,
      message: item.message || "Compile error",
      startLineNumber: line,
      startColumn: column,
      endLineNumber: line,
      endColumn: Math.max(column + 1, endColumn),
    };
  });

  editor.setModelMarkers(target, PLSQL_COMPILE_MARKER_OWNER, markers);

  if (markers.length > 0 && textEditor) {
    const first = markers[0];
    textEditor.revealPositionInCenter({
      lineNumber: first.startLineNumber,
      column: first.startColumn,
    });
    textEditor.setPosition({
      lineNumber: first.startLineNumber,
      column: first.startColumn,
    });
  }
}

export function revealPlsqlCompileError(
  line: number,
  column: number,
): void {
  const textEditor = EditorService.getActiveTextEditor();
  const model = textEditor?.getModel();
  if (!textEditor || !model) return;

  const lineNumber = clamp(line, 1, model.getLineCount());
  const maxColumn = model.getLineMaxColumn(lineNumber);
  const columnNumber = clamp(column, 1, maxColumn);
  textEditor.revealPositionInCenter({
    lineNumber,
    column: columnNumber,
  });
  textEditor.setPosition({ lineNumber, column: columnNumber });
  textEditor.focus();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
