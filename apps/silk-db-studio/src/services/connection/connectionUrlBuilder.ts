import type { ConnectionDriverId } from "./connectionTypes";
import {
  DEFAULT_MARIADB_URL,
  DEFAULT_MYSQL_URL,
  DEFAULT_ORACLE_URL,
  DEFAULT_POSTGRESQL_URL,
  DEFAULT_SQLSERVER_URL,
} from "./connectionTypes";

export type OracleConnectType = "service" | "sid";

export type StructuredConnectionFields = {
  host: string;
  port: string;
  /** Service name / SID / database name, depending on driver. Ignored (n/a) for Oracle
   *  callers that don't populate `oracleConnectType` meaningfully. */
  database: string;
  /** Only meaningful when driverId === "oracle". */
  oracleConnectType: OracleConnectType;
};

export const DEFAULT_PORT_BY_DRIVER: Record<ConnectionDriverId, number> = {
  oracle: 1521,
  sqlserver: 1433,
  mysql: 3306,
  mariadb: 3306,
  postgresql: 5432,
};

// statementPoolingCacheSize=0 disables mssql-jdbc's server-side prepared-statement cache.
// This connection is long-lived and shared across every tab bound to the profile (see
// ActiveDatabaseService.useDatabase), and DatabaseMetaData calls (e.g. the Columns tab's
// getColumns()) can reuse a cached statement handle from before a mid-session
// connection.setCatalog() — the driver then throws "prepared statement handle N is not
// valid in this context... verify current database ... not changed since the handle was
// prepared" (SQLState S0002). Disabling the cache trades a little metadata-query overhead
// for correctness under our live database-switching feature.
const SQLSERVER_FIXED_PARAMS =
  "encrypt=true;trustServerCertificate=true;statementPoolingCacheSize=0";

/**
 * Builds a JDBC URL from structured fields. Always returns a value — an empty host
 * builds the driver's plain default URL (matching today's "unset → default" behavior).
 */
export function buildJdbcUrl(
  driverId: ConnectionDriverId,
  fields: StructuredConnectionFields,
): string {
  const host = fields.host.trim();
  const database = fields.database.trim();
  const port = resolvePort(driverId, fields.port);

  if (!host) {
    return defaultUrlFor(driverId);
  }

  switch (driverId) {
    case "oracle":
      return fields.oracleConnectType === "sid"
        ? `jdbc:oracle:thin:@${host}:${port}:${database}`
        : `jdbc:oracle:thin:@${host}:${port}/${database}`;
    case "sqlserver": {
      const dbSegment = database ? `;databaseName=${database}` : "";
      return `jdbc:sqlserver://${host}:${port}${dbSegment};${SQLSERVER_FIXED_PARAMS}`;
    }
    case "mysql":
      return `jdbc:mysql://${host}:${port}${database ? `/${database}` : ""}`;
    case "mariadb":
      return `jdbc:mariadb://${host}:${port}${database ? `/${database}` : ""}`;
    case "postgresql":
      return `jdbc:postgresql://${host}:${port}/${database}`;
  }
}

/**
 * Attempts to parse `url` into structured fields for the given driver. Returns `null`
 * when the URL doesn't losslessly round-trip through {@link buildJdbcUrl} — callers must
 * fall back to Raw URL mode in that case rather than silently rebuilding a different URL.
 */
export function parseJdbcUrl(
  driverId: ConnectionDriverId,
  url: string,
): StructuredConnectionFields | null {
  const trimmed = url.trim();
  const parsed = tryRegexParse(driverId, trimmed);
  if (!parsed) return null;
  const rebuilt = buildJdbcUrl(driverId, parsed);
  return normalizeForCompare(driverId, rebuilt) === normalizeForCompare(driverId, trimmed)
    ? parsed
    : null;
}

function tryRegexParse(
  driverId: ConnectionDriverId,
  url: string,
): StructuredConnectionFields | null {
  switch (driverId) {
    case "oracle":
      return parseOracle(url);
    case "sqlserver":
      return parseSqlServer(url);
    case "mysql":
      return parseMysqlLike(url, "mysql");
    case "mariadb":
      return parseMysqlLike(url, "mariadb");
    case "postgresql":
      return parsePostgres(url);
  }
}

// Oracle accepts both the plain form (`@host:port/service`) and the "Easy Connect"
// double-slash form (`@//host:port/service`, common on AWS RDS et al.) — both are parsed,
// but buildJdbcUrl always emits the plain form; the round-trip check in parseJdbcUrl
// normalizes away this stylistic difference so double-slash URLs still parse.
function parseOracle(url: string): StructuredConnectionFields | null {
  const serviceMatch = /^jdbc:oracle:thin:@(?:\/\/)?([^:/]+):(\d+)\/([^/]+)$/i.exec(url);
  if (serviceMatch) {
    return {
      host: serviceMatch[1],
      port: serviceMatch[2],
      database: serviceMatch[3],
      oracleConnectType: "service",
    };
  }
  const sidMatch = /^jdbc:oracle:thin:@(?:\/\/)?([^:/]+):(\d+):([^:/]+)$/i.exec(url);
  if (sidMatch) {
    return {
      host: sidMatch[1],
      port: sidMatch[2],
      database: sidMatch[3],
      oracleConnectType: "sid",
    };
  }
  return null;
}

function normalizeForCompare(driverId: ConnectionDriverId, url: string): string {
  if (driverId === "oracle") {
    return url.replace(/^jdbc:oracle:thin:@\/\//i, "jdbc:oracle:thin:@");
  }
  return url;
}

function parseSqlServer(url: string): StructuredConnectionFields | null {
  const match = /^jdbc:sqlserver:\/\/([^:;/]+):(\d+);(.*)$/i.exec(url);
  if (!match) return null;
  const [, host, port, paramString] = match;
  const params = paramString.split(";").filter((part) => part.length > 0);

  let database = "";
  const remaining: string[] = [];
  for (const param of params) {
    const eq = param.indexOf("=");
    const key = eq === -1 ? param : param.slice(0, eq);
    if (key.toLowerCase() === "databasename") {
      database = eq === -1 ? "" : param.slice(eq + 1);
      continue;
    }
    remaining.push(param);
  }

  const remainingNormalized = remaining
    .map((param) => param.toLowerCase())
    .sort()
    .join(";");
  const expectedNormalized = SQLSERVER_FIXED_PARAMS.split(";")
    .map((param) => param.toLowerCase())
    .sort()
    .join(";");
  if (remainingNormalized !== expectedNormalized) {
    return null;
  }

  return { host, port, database, oracleConnectType: "service" };
}

function parseMysqlLike(
  url: string,
  vendor: "mysql" | "mariadb",
): StructuredConnectionFields | null {
  const pattern = new RegExp(`^jdbc:${vendor}:\\/\\/([^:/?]+):(\\d+)(?:\\/([^?]*))?$`, "i");
  const match = pattern.exec(url);
  if (!match) return null;
  return {
    host: match[1],
    port: match[2],
    database: match[3] ?? "",
    oracleConnectType: "service",
  };
}

function parsePostgres(url: string): StructuredConnectionFields | null {
  const match = /^jdbc:postgresql:\/\/([^:/?]+):(\d+)\/([^?]+)$/i.exec(url);
  if (!match) return null;
  return {
    host: match[1],
    port: match[2],
    database: match[3],
    oracleConnectType: "service",
  };
}

function resolvePort(driverId: ConnectionDriverId, port: string): string {
  const trimmed = port.trim();
  if (/^\d+$/.test(trimmed)) return trimmed;
  return String(DEFAULT_PORT_BY_DRIVER[driverId]);
}

function defaultUrlFor(driverId: ConnectionDriverId): string {
  switch (driverId) {
    case "oracle":
      return DEFAULT_ORACLE_URL;
    case "sqlserver":
      return DEFAULT_SQLSERVER_URL;
    case "mysql":
      return DEFAULT_MYSQL_URL;
    case "mariadb":
      return DEFAULT_MARIADB_URL;
    case "postgresql":
      return DEFAULT_POSTGRESQL_URL;
  }
}
