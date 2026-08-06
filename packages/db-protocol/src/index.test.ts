import { describe, expect, it } from "vitest";
import {
  isConnectionDependenciesResult,
  isConnectionDdlResult,
  isConnectionMetadataResult,
  isConnectionPrimaryKeysResult,
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

describe("isConnectionDependenciesResult", () => {
  it("accepts dependencies + dialectId", () => {
    expect(
      isConnectionDependenciesResult({
        dialectId: "oracle",
        dependencies: [
          {
            schema: "HR",
            name: "EMPLOYEES",
            type: "TABLE",
            dependencyType: "HARD",
          },
        ],
      }),
    ).toBe(true);
  });

  it("accepts empty dependencies", () => {
    expect(
      isConnectionDependenciesResult({
        dialectId: "postgresql",
        dependencies: [],
      }),
    ).toBe(true);
  });

  it("rejects malformed dependency entries", () => {
    expect(
      isConnectionDependenciesResult({
        dialectId: "oracle",
        dependencies: [{ schema: "HR" }],
      }),
    ).toBe(false);
  });
});

describe("isConnectionPrimaryKeysResult", () => {
  it("accepts keys with optional relationKind", () => {
    expect(
      isConnectionPrimaryKeysResult({
        keys: [{ name: "ID" }],
        schema: "HR",
        relationKind: "view",
      }),
    ).toBe(true);
  });

  it("rejects invalid relationKind", () => {
    expect(
      isConnectionPrimaryKeysResult({
        keys: [],
        relationKind: "synonym",
      }),
    ).toBe(false);
  });
});

describe("isConnectionMetadataResult", () => {
  it("accepts catalog explorer payloads", () => {
    expect(
      isConnectionMetadataResult({
        schemas: [],
        catalogs: [{ name: "PSM" }, { name: "ACM" }],
        currentCatalog: "PSM",
      }),
    ).toBe(true);
  });

  it("rejects malformed catalogs", () => {
    expect(
      isConnectionMetadataResult({
        schemas: [],
        catalogs: [{ id: "PSM" }],
      }),
    ).toBe(false);
  });
});
