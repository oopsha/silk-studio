export type LocaleId = "en" | "ko";

export const LOCALE_IDS: readonly LocaleId[] = ["en", "ko"] as const;

export function isLocaleId(value: unknown): value is LocaleId {
  return value === "en" || value === "ko";
}

/** Prefer Korean when the runtime UI language is Korean; otherwise English. */
export function detectDefaultLocale(
  language = typeof navigator !== "undefined" ? navigator.language : "en",
): LocaleId {
  return language.toLowerCase().startsWith("ko") ? "ko" : "en";
}

export function normalizeLocale(value: unknown, fallback: LocaleId = "en"): LocaleId {
  if (isLocaleId(value)) return value;
  if (typeof value === "string" && value.toLowerCase().startsWith("ko")) {
    return "ko";
  }
  return fallback;
}
