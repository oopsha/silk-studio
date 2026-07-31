import { describe, expect, it } from "vitest";
import {
  isConnectionDdlResult,
  isQueryResultPayload,
} from "./index";

describe("isQueryResultPayload", () => {
  it("accepts a minimal resultSet payload", () => {
    expect(
      isQueryResultPayload({
        kind: "resultSet",
        columns: ["ID"],
        rows: [["1"], [null]],
        rowCount: 2,
        updateCount: null,
        message: "ok",
      }),
    ).toBe(true);
  });

  it("rejects malformed rows", () => {
    expect(
      isQueryResultPayload({
        kind: "resultSet",
        columns: ["ID"],
        rows: [[1]],
        rowCount: 1,
        updateCount: null,
        message: "ok",
      }),
    ).toBe(false);
  });
});

describe("isConnectionDdlResult", () => {
  it("accepts ddl + dialectId", () => {
    expect(
      isConnectionDdlResult({
        ddl: "CREATE TABLE t (id INT)",
        dialectId: "oracle",
      }),
    ).toBe(true);
  });

  it("rejects missing fields", () => {
    expect(isConnectionDdlResult({ ddl: "x" })).toBe(false);
  });
});
