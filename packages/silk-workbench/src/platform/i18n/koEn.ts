import { getActiveLocale } from "./activeLocale";

/** For shared parts that carry their two texts inline instead of a catalog key. */
export function koEn(korean: string, english: string): string {
  return getActiveLocale() === "en" ? english : korean;
}
