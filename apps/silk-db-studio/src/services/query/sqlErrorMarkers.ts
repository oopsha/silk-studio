import { editor, MarkerSeverity } from "monaco-editor";
import { EditorService } from "@silk-studio/editor/services/editor/editorServiceFacade.ts";
import {
  parseSqlErrorPosition,
  positionToOffset,
} from "./sqlErrorPosition";

export const SQL_ERROR_MARKER_OWNER = "silk.sql";

export type SqlSourceRange = {
  start: number;
  end: number;
};

export function clearSqlErrorMarkers(): void {
  const model = EditorService.getActiveTextEditor()?.getModel();
  if (!model) return;
  editor.setModelMarkers(model, SQL_ERROR_MARKER_OWNER, []);
}

export type ApplySqlErrorMarkersOptions = {
  /** When false, place markers without scrolling/focusing the editor. Default true. */
  reveal?: boolean;
};

/**
 * Places an error marker on the active Monaco model when the message (or source
 * range) yields a usable location. Optionally scrolls the editor to the marker.
 */
export function applySqlErrorMarkers(
  message: string,
  sourceRange?: SqlSourceRange | null,
  options?: ApplySqlErrorMarkersOptions,
): void {
  const textEditor = EditorService.getActiveTextEditor();
  const model = textEditor?.getModel();
  if (!model || !textEditor) return;

  const contentLength = model.getValueLength();
  const rangeStart = clamp(sourceRange?.start ?? 0, 0, contentLength);
  const rangeEnd = clamp(
    sourceRange?.end ?? contentLength,
    rangeStart,
    contentLength,
  );

  if (rangeEnd <= rangeStart && !sourceRange) {
    return;
  }

  const statement = model.getValue().slice(rangeStart, rangeEnd);
  const parsed = parseSqlErrorPosition(message);

  let markerStart: number;
  let markerEnd: number;

  if (parsed && statement.length > 0) {
    const relative = positionToOffset(statement, parsed);
    markerStart = rangeStart + relative;
    markerEnd = expandMarkerEnd(model.getValue(), markerStart, rangeEnd);
  } else if (rangeEnd > rangeStart) {
    // No precise position — highlight the executed statement/selection.
    markerStart = rangeStart;
    markerEnd = rangeEnd;
  } else {
    return;
  }

  markerStart = clamp(markerStart, 0, contentLength);
  markerEnd = clamp(Math.max(markerStart + 1, markerEnd), markerStart + 1, contentLength);

  const startPos = model.getPositionAt(markerStart);
  const endPos = model.getPositionAt(markerEnd);
  const hover = firstMeaningfulLine(message);

  editor.setModelMarkers(model, SQL_ERROR_MARKER_OWNER, [
    {
      severity: MarkerSeverity.Error,
      message: hover,
      startLineNumber: startPos.lineNumber,
      startColumn: startPos.column,
      endLineNumber: endPos.lineNumber,
      endColumn: endPos.column,
    },
  ]);

  if (options?.reveal === false) {
    return;
  }

  textEditor.revealPositionInCenter(startPos);
  textEditor.setPosition(startPos);
  textEditor.focus();
}

function expandMarkerEnd(
  content: string,
  start: number,
  rangeEnd: number,
): number {
  if (start >= rangeEnd) {
    return Math.min(content.length, start + 1);
  }

  let end = start + 1;
  const startCh = content[start];
  if (startCh && /[A-Za-z0-9_$]/.test(startCh)) {
    while (end < rangeEnd && /[A-Za-z0-9_$]/.test(content[end])) {
      end += 1;
    }
  }
  return Math.max(start + 1, end);
}

function firstMeaningfulLine(message: string): string {
  const lines = message.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^SQL execution failed$/i.test(trimmed)) continue;
    if (/^SQLState:/i.test(trimmed) || /^ErrorCode:/i.test(trimmed)) continue;
    const withoutPrefix = trimmed.replace(/^Message:\s*/i, "");
    return withoutPrefix || trimmed;
  }
  return message.trim() || "SQL error";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
