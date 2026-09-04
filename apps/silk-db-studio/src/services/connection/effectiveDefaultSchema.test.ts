import { describe, expect, it } from "vitest";
import { effectiveDefaultSchema } from "./connectionTypes";

describe("effectiveDefaultSchema", () => {
  it("uses explicit default schema when set", () => {
    expect(
      effectiveDefaultSchema({
        driverId: "oracle",
        defaultSchema: "APP",
        user: "hr",
        catalog: "",
      }),
    ).toBe("APP");
  });

  it("falls back to login user for Oracle when default schema is empty", () => {
    expect(
      effectiveDefaultSchema({
        driverId: "oracle",
        defaultSchema: "  ",
        user: "hr",
        catalog: "",
      }),
    ).toBe("hr");
  });

  it("falls back to dbo for SQL Server when schema is empty", () => {
    expect(
      effectiveDefaultSchema({
        driverId: "sqlserver",
        defaultSchema: "",
        user: "sa",
        catalog: "AdventureWorks",
      }),
    ).toBe("dbo");
  });

  it("falls back to public for PostgreSQL when schema is empty", () => {
    expect(
      effectiveDefaultSchema({
        driverId: "postgresql",
        defaultSchema: "",
        user: "postgres",
        catalog: "app",
      }),
    ).toBe("public");
  });

  it("uses catalog for MySQL-style drivers", () => {
    expect(
      effectiveDefaultSchema({
        driverId: "mysql",
        defaultSchema: "",
        user: "root",
        catalog: "shop",
      }),
    ).toBe("shop");
  });
});
