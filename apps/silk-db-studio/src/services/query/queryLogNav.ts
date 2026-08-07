import { EditorService } from "@silk-studio/editor/services/editor/editorServiceFacade.ts";
import {
  applySqlErrorMarkers,
  type SqlSourceRange,
} from "./sqlErrorMarkers";

export type QueryLogTextPart = {
  kind: "text";
  text: string;
};

export type QueryLogLinkPart = {
  kind: "link";
  text: string;
  range: SqlSourceRange;
  /** Short text for "Copy Message". */
  message: string;
  /** Full driver/error body — used for marker position parsing. */
  detail: string;
  /** Full error block for "Copy Full Error". */
  fullText: string;
};

export type QueryLogPart = QueryLogTextPart | QueryLogLinkPart;

export function partsToOutput(parts: QueryLogPart[]): string {
  return parts.map((part) => part.text).join("");
}

export function firstErrorMessageLine(message: string): string {
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

export function resolveSourceLineNumber(
  range: SqlSourceRange | null | undefined,
): number | null {
  if (!range) return null;
  const model = EditorService.getActiveTextEditor()?.getModel();
  if (!model) return null;
  const length = model.getValueLength();
  const offset = Math.max(0, Math.min(range.start, length));
  return model.getPositionAt(offset).lineNumber;
}

function linkLabel(
  range: SqlSourceRange,
  batchIndex?: number,
): string {
  const line = resolveSourceLineNumber(range);
  if (line != null) return `line ${line}`;
  if (batchIndex != null) return `batch ${batchIndex}`;
  return "source";
}

/**
 * Builds plain output + rich log parts for an execution error.
 * Linkable span is a short `line N` / `batch N` label (VS Code terminal style).
 */
export function buildLinkedErrorLog(
  message: string,
  range: SqlSourceRange | null | undefined,
  options?: { batchIndex?: number; batchTotal?: number },
): { output: string; logParts: QueryLogPart[] } {
  const batchLabel =
    options?.batchIndex != null && options.batchTotal != null
      ? `[${options.batchIndex}/${options.batchTotal}] `
      : "";

  if (!range) {
    const text = `${batchLabel}ERROR\n${message}`;
    return { output: text, logParts: [{ kind: "text", text }] };
  }

  const label = linkLabel(range, options?.batchIndex);
  const head = `${batchLabel}ERROR `;
  const fullText = `${head}${label}\n${message}`;
  const shortMessage = firstErrorMessageLine(message);

  return {
    output: fullText,
    logParts: [
      { kind: "text", text: head },
      {
        kind: "link",
        text: label,
        range,
        message: shortMessage,
        detail: message,
        fullText,
      },
      { kind: "text", text: `\n${message}` },
    ],
  };
}

export function goToLogError(link: QueryLogLinkPart): void {
  applySqlErrorMarkers(link.detail, link.range, { reveal: true });
}

export function isModifiedClick(event: {
  ctrlKey: boolean;
  metaKey: boolean;
}): boolean {
  return event.ctrlKey || event.metaKey;
}

export function modifierClickLabel(): "Ctrl" | "Cmd" {
  if (typeof navigator === "undefined") return "Ctrl";
  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  const platform = nav.userAgentData?.platform ?? navigator.platform ?? "";
  return /mac|iphone|ipad|ipod/i.test(String(platform)) ? "Cmd" : "Ctrl";
}
