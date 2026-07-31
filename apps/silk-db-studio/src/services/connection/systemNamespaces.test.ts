import { describe, expect, it } from "vitest";
import {
  filterSystemNamespaces,
  isSystemNamespace,
} from "./systemNamespaces";

describe("isSystemNamespace", () => {
  it("detects SQL Server system catalogs", () => {
    expect(isSystemNamespace("sqlserver", "master")).toBe(true);
    expect(isSystemNamespace("sqlserver", "PSM")).toBe(false);
  });

  it("detects MySQL system catalogs", () => {
    expect(isSystemNamespace("mysql", "information_schema")).toBe(true);
    expect(isSystemNamespace("mariadb", "sys")).toBe(true);
    expect(isSystemNamespace("mysql", "app")).toBe(false);
  });

  it("detects PostgreSQL system schemas", () => {
    expect(isSystemNamespace("postgresql", "pg_catalog")).toBe(true);
    expect(isSystemNamespace("postgresql", "pg_temp_3")).toBe(true);
    expect(isSystemNamespace("postgresql", "public")).toBe(false);
  });

  it("detects Oracle system schemas case-insensitively", () => {
    expect(isSystemNamespace("oracle", "sys")).toBe(true);
    expect(isSystemNamespace("oracle", "HR")).toBe(false);
  });
});

describe("filterSystemNamespaces", () => {
  it("keeps all when showSystemObjects is true", () => {
    expect(
      filterSystemNamespaces(["master", "PSM"], {
        driverId: "sqlserver",
        showSystemObjects: true,
      }),
    ).toEqual(["master", "PSM"]);
  });

  it("hides system names when showSystemObjects is false", () => {
    expect(
      filterSystemNamespaces(["master", "PSM", "tempdb"], {
        driverId: "sqlserver",
        showSystemObjects: false,
      }),
    ).toEqual(["PSM"]);
  });
});
