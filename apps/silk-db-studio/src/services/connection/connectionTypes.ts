export type ConnectionDriverId = "oracle" | "sqlserver" | "mysql";

export type ConnectionProfile = {
  id: string;
  name: string;
  driverId: ConnectionDriverId;
  url: string;
  user: string;
  password: string;
  /** Database/catalog applied on connect (SQL Server `USE`); unused by Oracle. */
  catalog: string;
  /** Default schema applied on connect (Oracle) or highlighted in Explorer (SQL Server). */
  defaultSchema: string;
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
};

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export type ConnectionState = {
  profiles: ConnectionProfile[];
  activeProfileId: string | null;
  connectedProfileId: string | null;
  status: ConnectionStatus;
  errorMessage: string | null;
};

export const DEFAULT_ORACLE_URL =
  "jdbc:oracle:thin:@localhost:1521/FREEPDB1";

export const DEFAULT_SQLSERVER_URL =
  "jdbc:sqlserver://localhost:1433;encrypt=true;trustServerCertificate=true";

export const DEFAULT_MYSQL_URL = "jdbc:mysql://localhost:3306";

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

export function defaultUrlForDriver(driverId: ConnectionDriverId): string {
  return getConnectionDriver(driverId).defaultUrl;
}
