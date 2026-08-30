import type { ConnectionDriverId } from "./connectionTypes";

/** SQL Server system databases (catalogs). */
const SQLSERVER_SYSTEM_CATALOGS = new Set([
  "master",
  "model",
  "msdb",
  "tempdb",
]);

/**
 * SQL Server system schemas *within* a catalog — distinct from the catalog-level set above.
 * Every database gets one schema per fixed database role (db_owner, db_datareader, ...) plus
 * `guest`/`sys`/`information_schema`; none of these are ever something a user browses for.
 */
const SQLSERVER_SYSTEM_SCHEMAS = new Set([
  "guest",
  "sys",
  "information_schema",
  "db_accessadmin",
  "db_backupoperator",
  "db_datareader",
  "db_datawriter",
  "db_ddladmin",
  "db_denydatareader",
  "db_denydatawriter",
  "db_owner",
  "db_securityadmin",
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
 * Also includes the Oracle Cloud Autonomous Database (ADB) built-ins — `APEX_<version>` is
 * handled separately below (via a prefix check) since the version suffix changes per
 * provisioning.
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
  // Oracle Cloud Autonomous Database built-ins.
  "ADBSNMP",
  "ADB_APP_STORE",
  "APEX_PUBLIC_USER",
  "APEX_REST_PUBLIC_USER",
  "APEX_INSTANCE_ADMIN_USER",
  "ORDS_METADATA",
  "ORDS_PUBLIC_USER",
  "DBSFWUSER",
  "GSMROOTUSER",
  "PDBADMIN",
]);

export type ExplorerFilterContext = {
  driverId: ConnectionDriverId;
  showSystemObjects: boolean;
};

/**
 * SQL Server has two real levels (catalog, then schema within it) with *different* system-name
 * sets — `master` is a system catalog but isn't a schema name, and `db_owner` is a system
 * schema but isn't a catalog name. Other drivers don't distinguish the two, so `level` is a
 * no-op for them; only the `"sqlserver"` branch below actually reads it.
 */
export type NamespaceLevel = "catalog" | "schema";

/** True when `name` is a known system catalog/schema for the driver. */
export function isSystemNamespace(
  driverId: ConnectionDriverId,
  name: string,
  level: NamespaceLevel,
): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;

  switch (driverId) {
    case "sqlserver":
      return level === "catalog"
        ? SQLSERVER_SYSTEM_CATALOGS.has(trimmed.toLowerCase())
        : SQLSERVER_SYSTEM_SCHEMAS.has(trimmed.toLowerCase());
    case "mysql":
    case "mariadb":
      return MYSQL_SYSTEM_CATALOGS.has(trimmed.toLowerCase());
    case "postgresql": {
      const lower = trimmed.toLowerCase();
      if (POSTGRES_SYSTEM_SCHEMAS.has(lower)) return true;
      // Temporary schemas: pg_temp_NN, pg_toast_temp_NN
      return lower.startsWith("pg_temp_") || lower.startsWith("pg_toast_temp_");
    }
    case "oracle": {
      const upper = trimmed.toUpperCase();
      // APEX workspace/component schemas carry the install's APEX version in the name
      // (APEX_230100, APEX_260100, ...) — a prefix check covers every version instead of an
      // exhaustive, always-stale list of exact names.
      return ORACLE_SYSTEM_SCHEMAS.has(upper) || upper.startsWith("APEX_");
    }
    default:
      return false;
  }
}

export function filterSystemNamespaces(
  names: string[],
  filter: ExplorerFilterContext | null | undefined,
  level: NamespaceLevel,
): string[] {
  if (!filter || filter.showSystemObjects) return names;
  return names.filter((name) => !isSystemNamespace(filter.driverId, name, level));
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
