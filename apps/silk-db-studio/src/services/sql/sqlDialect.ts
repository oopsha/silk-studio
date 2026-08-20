import type { ConnectionDriverId } from "../connection/connectionTypes";
import { ConnectionService } from "../connection/connectionService";
import { EditorConnectionBindingService } from "../connection/editorConnectionBindingService";
import type { SqlLanguage } from "sql-formatter";

/** Monaco language IDs used for dialect-aware SQL highlighting. */
export type SqlMonacoLanguageId =
  | "plsql"
  | "tsql"
  | "mysql"
  | "mariadb"
  | "pgsql"
  | "sql";

const DRIVER_MONACO_LANGUAGE: Record<ConnectionDriverId, SqlMonacoLanguageId> =
  {
    oracle: "plsql",
    sqlserver: "tsql",
    mysql: "mysql",
    mariadb: "mariadb",
    postgresql: "pgsql",
  };

const DRIVER_FORMATTER_LANGUAGE: Record<ConnectionDriverId, SqlLanguage> = {
  oracle: "plsql",
  sqlserver: "transactsql",
  mysql: "mysql",
  mariadb: "mariadb",
  postgresql: "postgresql",
};

const SQL_LANGUAGE_IDS = new Set<string>([
  "sql",
  "plsql",
  "tsql",
  "mysql",
  "mariadb",
  "pgsql",
]);

export function isSqlLanguageId(languageId: string): boolean {
  return SQL_LANGUAGE_IDS.has(languageId);
}

export function monacoLanguageIdForDriver(
  driverId: ConnectionDriverId,
): SqlMonacoLanguageId {
  return DRIVER_MONACO_LANGUAGE[driverId];
}

/**
 * Monaco language for a tab binding. No profile → neutral generic SQL
 * (not a vendor dialect).
 */
export function monacoLanguageIdForProfile(
  profileId: string | null | undefined,
): SqlMonacoLanguageId {
  const id = profileId?.trim() || null;
  if (!id) return "sql";
  const profile = ConnectionService.getProfile(id);
  if (!profile) return "sql";
  return monacoLanguageIdForDriver(profile.driverId);
}

export function formatterLanguageForDriver(
  driverId: ConnectionDriverId,
): SqlLanguage {
  return DRIVER_FORMATTER_LANGUAGE[driverId];
}

/**
 * True when this driver implicitly commits DDL (CREATE/ALTER/DROP/TRUNCATE/GRANT/REVOKE) as
 * part of running it — Oracle and MySQL/MariaDB always auto-commit DDL, even with
 * autocommit off, so there is never anything left pending to commit or roll back afterward.
 * PostgreSQL and SQL Server instead run DDL inside the normal transaction like any other
 * statement — a `ROLLBACK` there genuinely undoes a `CREATE TABLE`/`CREATE PROCEDURE`.
 */
export function driverAutoCommitsDdl(driverId: ConnectionDriverId): boolean {
  return driverId === "oracle" || driverId === "mysql" || driverId === "mariadb";
}

/**
 * Prefer the active editor tab binding's driver, then any connected profile,
 * then the active profile, then Oracle (studio default).
 * Used for execution / completion — not for editor language mode.
 */
export function resolveActiveDriverId(
  profileId?: string | null,
): ConnectionDriverId {
  const bindingId =
    profileId?.trim() ||
    EditorConnectionBindingService.getActiveBinding().profileId?.trim() ||
    null;
  if (bindingId) {
    const bound = ConnectionService.getProfile(bindingId);
    if (bound) return bound.driverId;
  }
  const connected = ConnectionService.getConnectedProfile();
  if (connected) return connected.driverId;
  const active = ConnectionService.getActiveProfile();
  if (active) return active.driverId;
  return "oracle";
}

/** Editor language from the active tab binding; unbound → generic SQL. */
export function resolveActiveMonacoLanguageId(): SqlMonacoLanguageId {
  return monacoLanguageIdForProfile(
    EditorConnectionBindingService.getActiveBinding().profileId,
  );
}
