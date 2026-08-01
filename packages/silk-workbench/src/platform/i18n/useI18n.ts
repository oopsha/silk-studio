import { useCallback, useEffect, useState } from "react";
import { I18nService, type MessageKey } from "./i18nService";
import type { LocaleId } from "./locale";

export function useI18n(): {
  locale: LocaleId;
  t: (key: MessageKey) => string;
} {
  const [locale, setLocale] = useState(() => I18nService.getLocale());

  useEffect(() => {
    I18nService.start();
    setLocale(I18nService.getLocale());
    return I18nService.onDidChangeLocale(() => {
      setLocale(I18nService.getLocale());
    });
  }, []);

  const t = useCallback((key: MessageKey) => I18nService.t(key), [locale]);

  return {
    locale,
    t,
  };
}
