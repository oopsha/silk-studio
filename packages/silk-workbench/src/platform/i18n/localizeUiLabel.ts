import { getActiveLocale } from "./activeLocale";
import { appEnglishLabel } from "./appLabels";
import { I18nService } from "./i18nService";
import { ENGLISH_LABEL_KEYS, normalizeEnglishLabel } from "./labelMap";

/** Localize a hardcoded English workbench/menu label (or an app's own label) when a mapping exists. */
export function localizeUiLabel(englishLabel: string): string {
  const key = ENGLISH_LABEL_KEYS[normalizeEnglishLabel(englishLabel)];
  if (!key) return (getActiveLocale() === "en" ? appEnglishLabel(englishLabel) : undefined) ?? englishLabel;
  return I18nService.t(key);
}
