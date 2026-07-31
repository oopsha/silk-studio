import { describe, expect, it } from "vitest";
import {
  assertReadOnlyQueryAllowed,
  isWriteSql,
} from "./sqlGuard";

describe("isWriteSql", () => {
  it("detects common write / DDL verbs", () => {
    expect(isWriteSql("INSERT INTO t VALUES (1)")).toBe(true);
    expect(isWriteSql("  update t set a=1")).toBe(true);
    expect(isWriteSql("DELETE FROM t")).toBe(true);
    expect(isWriteSql("DROP TABLE t")).toBe(true);
    expect(isWriteSql("CREATE TABLE t (id INT)")).toBe(true);
  });

  it("allows typical read statements", () => {
    expect(isWriteSql("SELECT * FROM t")).toBe(false);
    expect(isWriteSql("WITH x AS (SELECT 1) SELECT * FROM x")).toBe(false);
    expect(isWriteSql("EXPLAIN SELECT 1")).toBe(false);
  });
});

describe("assertReadOnlyQueryAllowed", () => {
  it("no-ops when readOnly is false", () => {
    expect(() => assertReadOnlyQueryAllowed("DELETE FROM t", false)).not.toThrow();
  });

  it("blocks write SQL when readOnly is true", () => {
    expect(() => assertReadOnlyQueryAllowed("DELETE FROM t", true)).toThrow(
      /Read-only mode/i,
    );
  });

  it("allows SELECT when readOnly is true", () => {
    expect(() => assertReadOnlyQueryAllowed("SELECT 1", true)).not.toThrow();
  });
});
