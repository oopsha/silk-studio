import { I18nService } from "./i18nService";
import { ENGLISH_LABEL_KEYS, normalizeEnglishLabel } from "./labelMap";

/** Localize a hardcoded English workbench/menu label when a mapping exists. */
export function localizeUiLabel(englishLabel: string): string {
  const key = ENGLISH_LABEL_KEYS[normalizeEnglishLabel(englishLabel)];
  if (!key) return englishLabel;
  return I18nService.t(key);
}
