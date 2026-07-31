import { describe, expect, it } from "vitest";
import { redactSecrets, sanitizeLogMessage } from "./redactSecrets";

describe("redactSecrets", () => {
  it("masks assignment-style secrets", () => {
    expect(redactSecrets("password=secret123")).toContain("***");
    expect(redactSecrets("password=secret123")).not.toContain("secret123");
    expect(redactSecrets("api_key: abcdef")).not.toContain("abcdef");
  });

  it("masks bearer tokens and OpenAI-style keys", () => {
    expect(redactSecrets("Authorization Bearer tok_abc.def")).toMatch(/Bearer \*\*\*/);
    expect(redactSecrets("key sk-abcdefghijklmnopqrstuvwxyz")).toContain("sk-***");
  });

  it("masks JDBC password query params", () => {
    const out = redactSecrets("jdbc:oracle:thin:@//h/db?user=u&password=p@ss");
    expect(out).toContain("password=***");
    expect(out).not.toContain("p@ss");
  });
});

describe("sanitizeLogMessage", () => {
  it("collapses whitespace and redacts", () => {
    expect(sanitizeLogMessage("  password=xyz  \n next  ")).toBe("password=*** next");
  });

  it("truncates very long messages", () => {
    const long = `safe ${"x".repeat(3_000)}`;
    const out = sanitizeLogMessage(long);
    expect(out.length).toBeLessThanOrEqual(2_000);
    expect(out.endsWith("…")).toBe(true);
  });
});
