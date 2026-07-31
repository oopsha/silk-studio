import type { ConnectionDriverId } from "./connectionTypes";

/** SQL Server system databases (catalogs). */
const SQLSERVER_SYSTEM_CATALOGS = new Set([
  "master",
  "model",
  "msdb",
  "tempdb",
]);

/** MySQL / MariaDB system databases (catalogs). */
const MYSQL_SYSTEM_CATALOGS = new Set([
  "information_schema",
  "mysql",
  "performance_schema",
  "sys",
]);

/** PostgreSQL system schemas. */
const POSTGRES_SYSTEM_SCHEMAS = new Set([
  "information_schema",
  "pg_catalog",
  "pg_toast",
]);

/**
 * Common Oracle system / built-in schemas. Not exhaustive of every optional
 * component schema, but covers the ones JDBC typically surfaces for all installs.
 */
const ORACLE_SYSTEM_SCHEMAS = new Set([
  "ANONYMOUS",
  "APPQOSSYS",
  "AUDSYS",
  "CTXSYS",
  "DBSNMP",
  "DIP",
  "DVSYS",
  "GGSYS",
  "GSMADMIN_INTERNAL",
  "GSMCATUSER",
  "GSMUSER",
  "LBACSYS",
  "MDSYS",
  "OJVMSYS",
  "OLAPSYS",
  "ORACLE_OCM",
  "ORDDATA",
  "ORDSYS",
  "OUTLN",
  "REMOTE_SCHEDULER_AGENT",
  "SYS",
  "SYSBACKUP",
  "SYSDG",
  "SYSKM",
  "SYSRAC",
  "SYSTEM",
  "WMSYS",
  "XDB",
  "XS$NULL",
]);

export type ExplorerFilterContext = {
  driverId: ConnectionDriverId;
  showSystemObjects: boolean;
};

/** True when `name` is a known system catalog/schema for the driver. */
export function isSystemNamespace(
  driverId: ConnectionDriverId,
  name: string,
): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;

  switch (driverId) {
    case "sqlserver":
      return SQLSERVER_SYSTEM_CATALOGS.has(trimmed.toLowerCase());
    case "mysql":
    case "mariadb":
      return MYSQL_SYSTEM_CATALOGS.has(trimmed.toLowerCase());
    case "postgresql": {
      const lower = trimmed.toLowerCase();
      if (POSTGRES_SYSTEM_SCHEMAS.has(lower)) return true;
      // Temporary schemas: pg_temp_NN, pg_toast_temp_NN
      return lower.startsWith("pg_temp_") || lower.startsWith("pg_toast_temp_");
    }
    case "oracle":
      return ORACLE_SYSTEM_SCHEMAS.has(trimmed.toUpperCase());
    default:
      return false;
  }
}

export function filterSystemNamespaces(
  names: string[],
  filter: ExplorerFilterContext | null | undefined,
): string[] {
  if (!filter || filter.showSystemObjects) return names;
  return names.filter((name) => !isSystemNamespace(filter.driverId, name));
}

export function showSystemObjectsHint(driverId: ConnectionDriverId): string {
  switch (driverId) {
    case "sqlserver":
      return "When off, hides master, model, msdb, and tempdb in the Explorer.";
    case "mysql":
    case "mariadb":
      return "When off, hides mysql, sys, information_schema, and performance_schema.";
    case "postgresql":
      return "When off, hides pg_catalog, information_schema, and other system schemas.";
    case "oracle":
      return "When off, hides SYS, SYSTEM, and other built-in schemas.";
    default:
      return "When off, hides vendor system databases or schemas in the Explorer.";
  }
}
