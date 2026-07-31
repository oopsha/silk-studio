import { detectDefaultLocale, type LocaleId } from "./locale";
import { translate, type MessageKey } from "./translate";

/** Locale used by non-React / service code (kept in sync by I18nService). */
let activeLocale: LocaleId = detectDefaultLocale();

export function getActiveLocale(): LocaleId {
  return activeLocale;
}

export function setActiveLocale(locale: LocaleId): void {
  activeLocale = locale;
}

/** Translate using the active workbench locale without importing ConfigurationService. */
export function tKey(key: MessageKey): string {
  return translate(key, activeLocale);
}
