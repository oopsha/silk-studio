import type { ConnectionDriverId } from "../connection/connectionTypes";
import { ConnectionService } from "../connection/connectionService";
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

export function formatterLanguageForDriver(
  driverId: ConnectionDriverId,
): SqlLanguage {
  return DRIVER_FORMATTER_LANGUAGE[driverId];
}

/**
 * Prefer the connected profile's driver, then the active profile, then Oracle
 * (the studio default when nothing is selected yet).
 */
export function resolveActiveDriverId(): ConnectionDriverId {
  const connected = ConnectionService.getConnectedProfile();
  if (connected) return connected.driverId;
  const active = ConnectionService.getActiveProfile();
  if (active) return active.driverId;
  return "oracle";
}

export function resolveActiveMonacoLanguageId(): SqlMonacoLanguageId {
  return monacoLanguageIdForDriver(resolveActiveDriverId());
}
