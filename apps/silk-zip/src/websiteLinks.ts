import { getActiveLocale } from "@silk-studio/workbench/platform/i18n/activeLocale.ts";

const SITE = "https://silkstudio.co.kr/";

/** Help menu entries that open a page of the website, in menu order; a new group starts a separator. */
export const WEBSITE_LINKS = [
  { id: "silkZip.help.userGuide", title: "사용 가이드", path: "silk-zip/guide/", group: "group-1" },
  { id: "silkZip.help.homepage", title: "홈페이지", path: "silk-zip/", group: "group-1" },
  { id: "silkZip.help.privacy", title: "개인정보 처리방침", path: "silk-zip/privacy/", group: "group-1" },
  { id: "silkZip.help.studio", title: "실크 스튜디오", path: "", group: "group-2" },
] as const;

/** The page's address in the display language (English pages are under `en/`). */
export function websiteUrl(path: string): string {
  return `${SITE}${getActiveLocale() === "en" ? "en/" : ""}${path}`;
}
