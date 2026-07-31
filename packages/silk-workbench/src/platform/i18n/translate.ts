import { isLocaleId, type LocaleId } from "./locale";
import {
  enMessages,
  type MessageCatalog,
  type MessageSchema,
} from "./messages/en";
import { koMessages } from "./messages/ko";

type NestedKeyOf<T, Prefix extends string = ""> = T extends string
  ? Prefix
  : {
      [K in keyof T & string]: NestedKeyOf<
        T[K],
        Prefix extends "" ? K : `${Prefix}.${K}`
      >;
    }[keyof T & string];

export type MessageKey = NestedKeyOf<MessageSchema>;

const CATALOG: Record<LocaleId, MessageCatalog> = {
  en: enMessages,
  ko: koMessages,
};

export function lookupMessage(
  tree: MessageCatalog,
  key: string,
): string | undefined {
  const parts = key.split(".");
  let node: unknown = tree;
  for (const part of parts) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

/** Resolve a message for an explicit locale (no ConfigurationService). */
export function translate(
  key: MessageKey,
  locale: LocaleId = "en",
): string {
  const resolved = isLocaleId(locale) ? locale : "en";
  return (
    lookupMessage(CATALOG[resolved], key) ??
    lookupMessage(enMessages, key) ??
    key
  );
}

export function messagesForLocale(locale: LocaleId): MessageCatalog {
  return CATALOG[isLocaleId(locale) ? locale : "en"];
}
