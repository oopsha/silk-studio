import { describe, expect, it } from "vitest";
import {
  filterSystemNamespaces,
  isSystemNamespace,
} from "./systemNamespaces";

describe("isSystemNamespace", () => {
  it("detects SQL Server system catalogs", () => {
    expect(isSystemNamespace("sqlserver", "master", "catalog")).toBe(true);
    expect(isSystemNamespace("sqlserver", "PSM", "catalog")).toBe(false);
  });

  it("detects SQL Server system schemas within a catalog, distinct from catalog names", () => {
    expect(isSystemNamespace("sqlserver", "dbo", "schema")).toBe(false);
    expect(isSystemNamespace("sqlserver", "sys", "schema")).toBe(true);
    expect(isSystemNamespace("sqlserver", "guest", "schema")).toBe(true);
    expect(isSystemNamespace("sqlserver", "INFORMATION_SCHEMA", "schema")).toBe(true);
    expect(isSystemNamespace("sqlserver", "db_owner", "schema")).toBe(true);
    expect(isSystemNamespace("sqlserver", "db_datareader", "schema")).toBe(true);
    // "master" is a system *catalog*, not a system *schema* — must not match here.
    expect(isSystemNamespace("sqlserver", "master", "schema")).toBe(false);
  });

  it("detects MySQL system catalogs", () => {
    expect(isSystemNamespace("mysql", "information_schema", "schema")).toBe(true);
    expect(isSystemNamespace("mariadb", "sys", "schema")).toBe(true);
    expect(isSystemNamespace("mysql", "app", "schema")).toBe(false);
  });

  it("detects PostgreSQL system schemas", () => {
    expect(isSystemNamespace("postgresql", "pg_catalog", "schema")).toBe(true);
    expect(isSystemNamespace("postgresql", "pg_temp_3", "schema")).toBe(true);
    expect(isSystemNamespace("postgresql", "public", "schema")).toBe(false);
  });

  it("detects Oracle system schemas case-insensitively", () => {
    expect(isSystemNamespace("oracle", "sys", "schema")).toBe(true);
    expect(isSystemNamespace("oracle", "HR", "schema")).toBe(false);
  });
});

describe("filterSystemNamespaces", () => {
  it("keeps all when showSystemObjects is true", () => {
    expect(
      filterSystemNamespaces(
        ["master", "PSM"],
        { driverId: "sqlserver", showSystemObjects: true },
        "catalog",
      ),
    ).toEqual(["master", "PSM"]);
  });

  it("hides system catalogs when showSystemObjects is false", () => {
    expect(
      filterSystemNamespaces(
        ["master", "PSM", "tempdb"],
        { driverId: "sqlserver", showSystemObjects: false },
        "catalog",
      ),
    ).toEqual(["PSM"]);
  });

  it("hides SQL Server system schemas (fixed database roles, sys, guest) when showSystemObjects is false", () => {
    expect(
      filterSystemNamespaces(
        ["dbo", "sys", "guest", "INFORMATION_SCHEMA", "db_owner", "db_datareader", "MyApp"],
        { driverId: "sqlserver", showSystemObjects: false },
        "schema",
      ),
    ).toEqual(["dbo", "MyApp"]);
  });
});
