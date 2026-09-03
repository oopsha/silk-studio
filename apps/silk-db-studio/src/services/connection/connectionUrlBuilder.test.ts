import { describe, expect, it } from "vitest";
import {
  DEFAULT_MARIADB_URL,
  DEFAULT_MYSQL_URL,
  DEFAULT_ORACLE_URL,
  DEFAULT_POSTGRESQL_URL,
  DEFAULT_SQLSERVER_URL,
} from "./connectionTypes";
import { buildJdbcUrl, parseJdbcUrl } from "./connectionUrlBuilder";

const EMPTY_FIELDS = {
  host: "",
  port: "",
  database: "",
  oracleConnectType: "service" as const,
};

describe("buildJdbcUrl", () => {
  it("returns each driver's default URL for empty fields", () => {
    expect(buildJdbcUrl("oracle", EMPTY_FIELDS)).toBe(DEFAULT_ORACLE_URL);
    expect(buildJdbcUrl("sqlserver", EMPTY_FIELDS)).toBe(DEFAULT_SQLSERVER_URL);
    expect(buildJdbcUrl("mysql", EMPTY_FIELDS)).toBe(DEFAULT_MYSQL_URL);
    expect(buildJdbcUrl("mariadb", EMPTY_FIELDS)).toBe(DEFAULT_MARIADB_URL);
    expect(buildJdbcUrl("postgresql", EMPTY_FIELDS)).toBe(DEFAULT_POSTGRESQL_URL);
  });

  it("builds an Oracle service-name URL", () => {
    expect(
      buildJdbcUrl("oracle", {
        host: "db1",
        port: "1522",
        database: "ORCL",
        oracleConnectType: "service",
      }),
    ).toBe("jdbc:oracle:thin:@db1:1522/ORCL");
  });

  it("builds an Oracle SID URL", () => {
    expect(
      buildJdbcUrl("oracle", {
        host: "db1",
        port: "1522",
        database: "ORCL",
        oracleConnectType: "sid",
      }),
    ).toBe("jdbc:oracle:thin:@db1:1522:ORCL");
  });

  it("builds a SQL Server URL with database", () => {
    expect(
      buildJdbcUrl("sqlserver", {
        host: "db1",
        port: "1433",
        database: "AdventureWorks",
        oracleConnectType: "service",
      }),
    ).toBe(
      "jdbc:sqlserver://db1:1433;databaseName=AdventureWorks;encrypt=true;trustServerCertificate=true;statementPoolingCacheSize=0",
    );
  });

  it("builds a SQL Server URL without database", () => {
    expect(
      buildJdbcUrl("sqlserver", { host: "db1", port: "1433", database: "", oracleConnectType: "service" }),
    ).toBe("jdbc:sqlserver://db1:1433;encrypt=true;trustServerCertificate=true;statementPoolingCacheSize=0");
  });

  it("builds MySQL/MariaDB URLs with and without database", () => {
    expect(
      buildJdbcUrl("mysql", { host: "db1", port: "3307", database: "app", oracleConnectType: "service" }),
    ).toBe("jdbc:mysql://db1:3307/app");
    expect(
      buildJdbcUrl("mysql", { host: "db1", port: "3307", database: "", oracleConnectType: "service" }),
    ).toBe("jdbc:mysql://db1:3307");
    expect(
      buildJdbcUrl("mariadb", { host: "db1", port: "3307", database: "app", oracleConnectType: "service" }),
    ).toBe("jdbc:mariadb://db1:3307/app");
  });

  it("builds a PostgreSQL URL", () => {
    expect(
      buildJdbcUrl("postgresql", { host: "db1", port: "5433", database: "app", oracleConnectType: "service" }),
    ).toBe("jdbc:postgresql://db1:5433/app");
  });

  it("falls back to the driver's default port when port is blank/invalid", () => {
    expect(
      buildJdbcUrl("postgresql", { host: "db1", port: "", database: "app", oracleConnectType: "service" }),
    ).toBe("jdbc:postgresql://db1:5432/app");
    expect(
      buildJdbcUrl("mysql", { host: "db1", port: "abc", database: "app", oracleConnectType: "service" }),
    ).toBe("jdbc:mysql://db1:3306/app");
  });
});

describe("parseJdbcUrl", () => {
  it("round-trips every driver's default URL", () => {
    expect(parseJdbcUrl("oracle", DEFAULT_ORACLE_URL)).not.toBeNull();
    expect(buildJdbcUrl("oracle", parseJdbcUrl("oracle", DEFAULT_ORACLE_URL)!)).toBe(DEFAULT_ORACLE_URL);

    expect(parseJdbcUrl("sqlserver", DEFAULT_SQLSERVER_URL)).not.toBeNull();
    expect(buildJdbcUrl("sqlserver", parseJdbcUrl("sqlserver", DEFAULT_SQLSERVER_URL)!)).toBe(
      DEFAULT_SQLSERVER_URL,
    );

    expect(parseJdbcUrl("mysql", DEFAULT_MYSQL_URL)).not.toBeNull();
    expect(buildJdbcUrl("mysql", parseJdbcUrl("mysql", DEFAULT_MYSQL_URL)!)).toBe(DEFAULT_MYSQL_URL);

    expect(parseJdbcUrl("mariadb", DEFAULT_MARIADB_URL)).not.toBeNull();
    expect(buildJdbcUrl("mariadb", parseJdbcUrl("mariadb", DEFAULT_MARIADB_URL)!)).toBe(DEFAULT_MARIADB_URL);

    expect(parseJdbcUrl("postgresql", DEFAULT_POSTGRESQL_URL)).not.toBeNull();
    expect(buildJdbcUrl("postgresql", parseJdbcUrl("postgresql", DEFAULT_POSTGRESQL_URL)!)).toBe(
      DEFAULT_POSTGRESQL_URL,
    );
  });

  it("parses an Oracle SID URL distinctly from service name", () => {
    expect(parseJdbcUrl("oracle", "jdbc:oracle:thin:@host:1521:XE")).toEqual({
      host: "host",
      port: "1521",
      database: "XE",
      oracleConnectType: "sid",
    });
  });

  it("parses an Oracle Easy Connect double-slash URL (e.g. AWS RDS)", () => {
    expect(
      parseJdbcUrl(
        "oracle",
        "jdbc:oracle:thin:@//rds-oracle-rms.cnuup99nwf66.ap-northeast-2.rds.amazonaws.com:1521/ORCL",
      ),
    ).toEqual({
      host: "rds-oracle-rms.cnuup99nwf66.ap-northeast-2.rds.amazonaws.com",
      port: "1521",
      database: "ORCL",
      oracleConnectType: "service",
    });
  });

  it("parses a SQL Server URL with a database name", () => {
    expect(parseJdbcUrl("sqlserver", "jdbc:sqlserver://host:1433;databaseName=db;encrypt=true;trustServerCertificate=true;statementPoolingCacheSize=0")).toEqual({
      host: "host",
      port: "1433",
      database: "db",
      oracleConnectType: "service",
    });
  });

  it("falls back to null for an Oracle TNS alias", () => {
    expect(parseJdbcUrl("oracle", "jdbc:oracle:thin:@myTnsAlias")).toBeNull();
  });

  it("falls back to null for SQL Server URLs with non-default params", () => {
    expect(
      parseJdbcUrl(
        "sqlserver",
        "jdbc:sqlserver://host:1433;databaseName=db;integratedSecurity=true",
      ),
    ).toBeNull();
    expect(
      parseJdbcUrl("sqlserver", "jdbc:sqlserver://host:1433;encrypt=false;trustServerCertificate=true"),
    ).toBeNull();
  });

  it("falls back to null for MySQL/PostgreSQL URLs with a query string", () => {
    expect(parseJdbcUrl("mysql", "jdbc:mysql://host:3306/db?useSSL=false")).toBeNull();
    expect(parseJdbcUrl("postgresql", "jdbc:postgresql://host:5432/db?ssl=true")).toBeNull();
  });

  it("falls back to null for malformed or mismatched-driver input", () => {
    expect(parseJdbcUrl("oracle", "not a url")).toBeNull();
    expect(parseJdbcUrl("oracle", "")).toBeNull();
    expect(parseJdbcUrl("oracle", DEFAULT_MYSQL_URL)).toBeNull();
  });

  it("falls back to null for SQL Server multi-host failover URLs", () => {
    expect(
      parseJdbcUrl("sqlserver", "jdbc:sqlserver://host1:1433,host2:1433;databaseName=db"),
    ).toBeNull();
  });
});
