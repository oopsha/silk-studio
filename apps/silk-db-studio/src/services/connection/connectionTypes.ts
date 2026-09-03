import type { SsmTunnelConfig } from "./ssmTunnelTypes";
import type { SshTunnelConfig } from "./sshTunnelTypes";

export type ConnectionDriverId =
  | "oracle"
  | "sqlserver"
  | "mysql"
  | "mariadb"
  | "postgresql";

export type ConnectionProfile = {
  id: string;
  name: string;
  driverId: ConnectionDriverId;
  url: string;
  user: string;
  password: string;
  /**
   * Database/catalog. SQL Server: applied via `USE`. MySQL/MariaDB: applied via `USE`.
   * PostgreSQL: select the database in the JDBC URL path (pgJDBC cannot switch databases
   * after connect). Oracle: unused.
   */
  catalog: string;
  /**
   * Default schema. Oracle: `ALTER SESSION SET CURRENT_SCHEMA`. PostgreSQL: `SET search_path`.
   * SQL Server: Explorer highlight only. MySQL/MariaDB: kept in sync with `catalog`.
   */
  defaultSchema: string;
  /**
   * When false (default), Explorer hides vendor system databases/schemas
   * (e.g. SQL Server master/tempdb, MySQL mysql/sys, PG pg_catalog, Oracle SYS).
   */
  showSystemObjects: boolean;
  /**
   * Optional AWS SSM Session Manager tunnel, opened before the JDBC connect when
   * `enabled`. The tunnel's remote target is this profile's own host/port (from `url`) —
   * `url` itself always keeps showing the real remote endpoint, never the local tunnel port.
   */
  ssmTunnel?: SsmTunnelConfig;
  /**
   * Optional SSH jump-host tunnel — mutually exclusive with `ssmTunnel` on the same profile
   * (enforced in the editor UI and defensively in `connectionService.ts`).
   */
  sshTunnel?: SshTunnelConfig;
  createdAt: number;
  updatedAt: number;
};

export type ConnectionProfileInput = {
  name: string;
  driverId: ConnectionDriverId;
  url: string;
  user: string;
  password: string;
  catalog: string;
  defaultSchema: string;
  showSystemObjects: boolean;
  ssmTunnel: SsmTunnelConfig;
  sshTunnel: SshTunnelConfig;
};

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export type ConnectionState = {
  profiles: ConnectionProfile[];
  activeProfileId: string | null;
  /** All currently open JDBC sessions (profile ids = agent connectionIds). */
  connectedProfileIds: string[];
  /**
   * Profiles with a `connect()` currently in flight (tunnel setup + JDBC handshake) — unlike
   * `status`, which only ever reflects the single most recent connect attempt, this supports
   * several profiles connecting at once (e.g. a cross-connection search bringing multiple
   * disconnected profiles online in parallel), so the Explorer can show a per-row "connecting…"
   * state instead of a plain unconnected dot for the whole duration.
   */
  connectingProfileIds: string[];
  /**
   * Most recently connected profile. Convenience for callers not yet multi-aware;
   * prefer {@link connectedProfileIds} / `isProfileConnected` when checking a specific profile.
   */
  connectedProfileId: string | null;
  status: ConnectionStatus;
  errorMessage: string | null;
};

export function isProfileConnected(
  state: Pick<ConnectionState, "connectedProfileIds">,
  profileId: string,
): boolean {
  return state.connectedProfileIds.includes(profileId);
}

export function isProfileConnecting(
  state: Pick<ConnectionState, "connectingProfileIds">,
  profileId: string,
): boolean {
  return state.connectingProfileIds.includes(profileId);
}

export const DEFAULT_ORACLE_URL =
  "jdbc:oracle:thin:@localhost:1521/FREEPDB1";

export const DEFAULT_SQLSERVER_URL =
  "jdbc:sqlserver://localhost:1433;encrypt=true;trustServerCertificate=true;statementPoolingCacheSize=0";

export const DEFAULT_MYSQL_URL = "jdbc:mysql://localhost:3306";

export const DEFAULT_MARIADB_URL = "jdbc:mariadb://localhost:3306";

export const DEFAULT_POSTGRESQL_URL = "jdbc:postgresql://localhost:5432/postgres";

/**
 * Static per-driver definition used by the connection editor to render the right fields/labels
 * and pick sane defaults. Add an entry here (+ a matching `DbDialect` in the jdbc-agent) to
 * support a new database — see the multi-jdbc-rollout plan for the intended rollout order.
 */
export type ConnectionDriverDefinition = {
  id: ConnectionDriverId;
  label: string;
  defaultUrl: string;
  /** Whether this driver distinguishes a catalog/database from schema (e.g. SQL Server). */
  supportsCatalog: boolean;
  catalogLabel: string;
  catalogHint: string;
  /**
   * Whether the editor should show a separate "Default Schema" field. False for drivers where
   * schema and catalog are the same thing (e.g. MySQL/MariaDB) — for those, `defaultSchema` is
   * kept in sync with `catalog` automatically (see connectionService.ts) instead of being a
   * separate user input.
   */
  showSchemaField: boolean;
  schemaLabel: string;
  schemaHint: string;
  /**
   * Whether the schema can be switched mid-session (Oracle `ALTER SESSION SET CURRENT_SCHEMA`,
   * PostgreSQL `SET search_path`), as opposed to only being applied once at connect. False for
   * drivers with no schema field (MySQL/MariaDB — catalog covers it) and for SQL Server, which
   * has no session-scoped equivalent (its default schema is an Explorer/UI hint only).
   */
  supportsRuntimeSchemaSwitch: boolean;
};

export const CONNECTION_DRIVERS: ConnectionDriverDefinition[] = [
  {
    id: "oracle",
    label: "Oracle (ojdbc11)",
    defaultUrl: DEFAULT_ORACLE_URL,
    supportsCatalog: false,
    catalogLabel: "Database",
    catalogHint: "",
    showSchemaField: true,
    schemaLabel: "Default Schema",
    schemaHint:
      "Applied on connect via ALTER SESSION SET CURRENT_SCHEMA. Leave empty to use the login user's schema.",
    supportsRuntimeSchemaSwitch: true,
  },
  {
    id: "sqlserver",
    label: "SQL Server (mssql-jdbc)",
    defaultUrl: DEFAULT_SQLSERVER_URL,
    supportsCatalog: true,
    catalogLabel: "Database",
    catalogHint: "Applied on connect via USE. Leave empty to use the login's default database.",
    showSchemaField: true,
    schemaLabel: "Default Schema",
    schemaHint:
      "Highlighted in the Explorer as the default schema for this connection (SQL Server has no session-level equivalent of Oracle's CURRENT_SCHEMA).",
    supportsRuntimeSchemaSwitch: false,
  },
  {
    id: "mysql",
    label: "MySQL (Connector/J)",
    defaultUrl: DEFAULT_MYSQL_URL,
    supportsCatalog: true,
    catalogLabel: "Database",
    catalogHint: "Applied on connect via USE. Leave empty to use the login's default database.",
    // MySQL has no schema concept distinct from the database itself, so there's no separate
    // "Default Schema" input — the Database field above doubles as the browsable namespace.
    showSchemaField: false,
    schemaLabel: "Default Schema",
    schemaHint: "",
    supportsRuntimeSchemaSwitch: false,
  },
  {
    id: "mariadb",
    label: "MariaDB (Connector/J)",
    defaultUrl: DEFAULT_MARIADB_URL,
    supportsCatalog: true,
    catalogLabel: "Database",
    catalogHint: "Applied on connect via USE. Leave empty to use the login's default database.",
    // Same as MySQL: no schema concept distinct from the database itself.
    showSchemaField: false,
    schemaLabel: "Default Schema",
    schemaHint: "",
    supportsRuntimeSchemaSwitch: false,
  },
  {
    id: "postgresql",
    label: "PostgreSQL (pgJDBC)",
    defaultUrl: DEFAULT_POSTGRESQL_URL,
    supportsCatalog: true,
    catalogLabel: "Database",
    catalogHint:
      "Specify the database in the JDBC URL path (jdbc:postgresql://host:5432/dbname). pgJDBC selects the database at connect time and cannot switch afterwards.",
    showSchemaField: true,
    schemaLabel: "Default Schema",
    schemaHint:
      "Applied on connect via SET search_path TO <schema>, public. Leave empty to use the login's default search_path.",
    supportsRuntimeSchemaSwitch: true,
  },
];

export function getConnectionDriver(
  driverId: ConnectionDriverId,
): ConnectionDriverDefinition {
  return (
    CONNECTION_DRIVERS.find((driver) => driver.id === driverId) ??
    CONNECTION_DRIVERS[0]
  );
}

/**
 * Effective default schema for Explorer highlight, preload, AI context, and connect.
 * Keeps the stored `defaultSchema` as entered (empty means "use login default").
 * Oracle: empty → login user (CURRENT_SCHEMA default).
 * Drivers without a schema field: catalog is the browsable namespace.
 */
export function effectiveDefaultSchema(
  profile: Pick<
    ConnectionProfile,
    "driverId" | "defaultSchema" | "user" | "catalog"
  >,
): string {
  const driver = getConnectionDriver(profile.driverId);
  if (!driver.showSchemaField) {
    return profile.catalog.trim() || profile.defaultSchema.trim();
  }
  const explicit = profile.defaultSchema.trim();
  if (explicit) return explicit;
  if (profile.driverId === "oracle") {
    return profile.user.trim();
  }
  return "";
}

export function defaultUrlForDriver(driverId: ConnectionDriverId): string {
  return getConnectionDriver(driverId).defaultUrl;
}

/** Codicon name for this driver's vendor icon (see Codicon.tsx's `db-*` custom icons). */
export function driverIconName(driverId: ConnectionDriverId): string {
  switch (driverId) {
    case "oracle":
      return "db-oracle";
    case "sqlserver":
      return "db-sqlserver";
    case "mysql":
      return "db-mysql";
    case "mariadb":
      return "db-mariadb";
    case "postgresql":
      return "db-postgresql";
  }
}
