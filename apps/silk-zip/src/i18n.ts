import { getActiveLocale } from "@silk-studio/workbench/platform/i18n/activeLocale.ts";
import { registerAppLabels } from "@silk-studio/workbench/platform/i18n/appLabels.ts";
import { EN } from "./messages";

// Menu and command titles stay Korean where they are registered; the shared menus translate them.
registerAppLabels(EN);

/** Locale for dates and numbers. */
export function displayLocale(): string {
  return getActiveLocale() === "en" ? "en-US" : "ko-KR";
}

/**
 * The text in the display language. The Korean text is the key; `{0}`, `{1}` take the values.
 * Call it while rendering or handling an event, not in module-level constants.
 */
export function tr(korean: string, ...values: unknown[]): string {
  const text = getActiveLocale() === "en" ? EN[korean] ?? korean : korean;
  return values.length ? text.replace(/\{(\d+)\}/g, (_, index: string) => String(values[Number(index)] ?? "")) : text;
}
