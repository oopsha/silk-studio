import { describe, expect, it } from "vitest";
import { detectDefaultLocale, normalizeLocale } from "./locale";
import { translate } from "./translate";

describe("locale helpers", () => {
  it("detects Korean from navigator-like tags", () => {
    expect(detectDefaultLocale("ko")).toBe("ko");
    expect(detectDefaultLocale("ko-KR")).toBe("ko");
    expect(detectDefaultLocale("en-US")).toBe("en");
  });

  it("normalizes invalid values", () => {
    expect(normalizeLocale("ko")).toBe("ko");
    expect(normalizeLocale("en")).toBe("en");
    expect(normalizeLocale("fr")).toBe("en");
    expect(normalizeLocale(undefined, "ko")).toBe("ko");
  });
});

describe("translate", () => {
  it("returns English and Korean messages", () => {
    expect(translate("settings.title", "en")).toBe("Settings");
    expect(translate("settings.title", "ko")).toBe("설정");
    expect(translate("settings.appearance.locale", "ko")).toBe("언어");
  });

  it("falls back to the key path only when unknown", () => {
    expect(translate("locale.en", "ko")).toBe("English");
  });

  it("translates app screen keys", () => {
    expect(translate("app.connection.newTitle", "ko")).toBe("새 연결");
    expect(translate("app.query.runStatement", "ko")).toBe("문 실행");
    expect(translate("app.ai.send", "ko")).toBe("전송");
    expect(translate("app.plsql.saveDialogTitle", "en")).toBe(
      "Save PL/SQL to Database",
    );
    expect(translate("app.query.idleOutput", "ko")).toContain("SQL");
    expect(translate("workbench.about.version", "ko")).toBe("버전");
  });
});
