import { describe, expect, it } from "vitest";
import {
  fingerprintSql,
  parameterMemoryKey,
} from "./sqlParameterMemoryStorage";

describe("fingerprintSql", () => {
  it("normalizes whitespace", () => {
    expect(fingerprintSql("select  1")).toBe(fingerprintSql("select 1"));
    expect(fingerprintSql("select\n1")).toBe(fingerprintSql("select 1"));
  });

  it("differs for different SQL", () => {
    expect(fingerprintSql("select :a from t")).not.toBe(
      fingerprintSql("select :a from u"),
    );
  });
});

describe("parameterMemoryKey", () => {
  it("scopes named params globally", () => {
    expect(
      parameterMemoryKey({ kind: "named", key: "Biz" }, "abc"),
    ).toBe("named:biz");
    expect(
      parameterMemoryKey({ kind: "named", key: "biz" }, null),
    ).toBe("named:biz");
  });

  it("scopes anonymous params by SQL fingerprint", () => {
    expect(
      parameterMemoryKey({ kind: "anonymous", key: "1" }, "fp1"),
    ).toBe("anon:fp1:1");
    expect(
      parameterMemoryKey({ kind: "anonymous", key: "1" }, "fp2"),
    ).toBe("anon:fp2:1");
  });
});
