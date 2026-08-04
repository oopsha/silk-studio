import { describe, expect, it } from "vitest";
import {
  extensionFromPath,
  isOpenableTextPath,
  languageIdFromPath,
} from "./languageFromPath";

describe("isOpenableTextPath", () => {
  it("accepts sql and common text extensions", () => {
    expect(isOpenableTextPath("D:\\work\\a.sql")).toBe(true);
    expect(isOpenableTextPath("/tmp/notes.txt")).toBe(true);
    expect(isOpenableTextPath("schema.json")).toBe(true);
  });

  it("rejects binary-looking extensions", () => {
    expect(isOpenableTextPath("setup.exe")).toBe(false);
    expect(isOpenableTextPath("photo.png")).toBe(false);
    expect(isOpenableTextPath("noext")).toBe(false);
  });
});

describe("languageIdFromPath", () => {
  it("maps sql and unknown text", () => {
    expect(languageIdFromPath("a.sql")).toBe("sql");
    expect(languageIdFromPath("a.txt")).toBe("plaintext");
    expect(extensionFromPath("C:\\x\\y.SQL")).toBe("sql");
  });
});
