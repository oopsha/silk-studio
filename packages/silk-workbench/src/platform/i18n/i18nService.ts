import { ConfigurationService } from "../configuration/configurationService";
import {
  detectDefaultLocale,
  normalizeLocale,
  type LocaleId,
} from "./locale";
import { setActiveLocale } from "./activeLocale";
import {
  lookupMessage,
  messagesForLocale,
  translate,
  type MessageKey,
} from "./translate";

export type { MessageKey } from "./translate";
export { translate } from "./translate";

type LocaleListener = () => void;

class I18nServiceImpl {
  private locale: LocaleId = detectDefaultLocale();
  private readonly listeners = new Set<LocaleListener>();
  private configUnsub: (() => void) | null = null;

  /** Call once after ConfigurationService is ready. */
  start(): void {
    if (this.configUnsub) return;
    this.syncFromConfiguration();
    this.applyDocumentLang();
    setActiveLocale(this.locale);
    this.configUnsub = ConfigurationService.onDidChange(() => {
      this.syncFromConfiguration();
    });
  }

  getLocale(): LocaleId {
    return this.locale;
  }

  t(key: MessageKey): string {
    const fromActive = lookupMessage(messagesForLocale(this.locale), key);
    if (fromActive !== undefined) return fromActive;
    return translate(key, "en");
  }

  onDidChangeLocale(listener: LocaleListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private syncFromConfiguration(): void {
    const raw = ConfigurationService.getValue("workbench.locale");
    const next = normalizeLocale(raw, detectDefaultLocale());
    if (next === this.locale) return;
    this.locale = next;
    setActiveLocale(next);
    this.applyDocumentLang();
    this.fire();
  }

  private applyDocumentLang(): void {
    if (typeof document === "undefined") return;
    document.documentElement.lang = this.locale;
  }

  private fire(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const I18nService = new I18nServiceImpl();
setActiveLocale(I18nService.getLocale());
