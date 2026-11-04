import type { ConnectionDriverId } from "./connectionTypes";
import { buildJdbcUrl } from "./connectionUrlBuilder";

export type ConnectionImportSource = "Silk" | "DBeaver" | "DataGrip";

export type ParsedConnectionImport = {
  source: ConnectionImportSource;
  profiles: unknown[];
  skipped: number;
};

type JsonRecord = Record<string, unknown>;

/** Converts Silk exports and the supported external connection formats into a shared shape. */
export function parseConnectionImportFile(raw: string): ParsedConnectionImport {
  const text = raw.trim();
  if (text.startsWith("<")) return parseDataGripXml(text);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("The selected file is not valid JSON or DataGrip XML.");
  }

  if (!isRecord(parsed)) throw new Error("The selected file has an unsupported format.");

  if (parsed.formatVersion === 1 && Array.isArray(parsed.profiles)) {
    return { source: "Silk", profiles: parsed.profiles, skipped: 0 };
  }

  if (isRecord(parsed.connections)) {
    const profiles: unknown[] = [];
    let skipped = 0;
    for (const [key, value] of Object.entries(parsed.connections)) {
      const profile = dbeaverConnectionToProfile(key, value);
      if (profile) profiles.push(profile);
      else skipped++;
    }
    return { source: "DBeaver", profiles, skipped };
  }

  throw new Error("The selected file has an unsupported connection format.");
}

function parseDataGripXml(xml: string): ParsedConnectionImport {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.getElementsByTagName("parsererror").length > 0) {
    throw new Error("The selected DataGrip XML file could not be parsed.");
  }

  const nodes = Array.from(document.getElementsByTagName("data-source"));
  if (nodes.length === 0) {
    throw new Error("The selected XML file contains no DataGrip connections.");
  }

  const profiles: unknown[] = [];
  let skipped = 0;
  for (const node of nodes) {
    const jdbcUrl = childText(node, "jdbc-url");
    const driverId = driverFromUrl(jdbcUrl);
    if (!driverId || !jdbcUrl) {
      skipped++;
      continue;
    }
    profiles.push({
      name: node.getAttribute("name")?.trim() || "Imported DataGrip connection",
      driverId,
      url: jdbcUrl,
      user: childText(node, "user-name"),
      catalog: "",
      defaultSchema: "",
      showSystemObjects: false,
    });
  }

  return { source: "DataGrip", profiles, skipped };
}

function dbeaverConnectionToProfile(key: string, value: unknown): unknown | null {
  if (!isRecord(value)) return null;
  const configuration = isRecord(value.configuration) ? value.configuration : value;
  const auth = isRecord(configuration["auth-properties"])
    ? configuration["auth-properties"]
    : {};
  const jdbcUrl = stringValue(configuration.url, value.url);
  const provider = stringValue(value.provider, value.driver);
  const driverId = driverFromUrl(jdbcUrl) ?? driverFromDBeaver(provider);
  if (!driverId) return null;

  let url = jdbcUrl;
  if (!url) {
    const host = stringValue(configuration.host, configuration.server);
    const port = stringValue(configuration.port);
    const database = stringValue(
      configuration.database,
      configuration.sid,
      configuration.serviceName,
    );
    if (driverId !== "sqlite" && !host) return null;
    if (driverId === "sqlite" && !database) return null;
    const connectType = stringValue(configuration.connectionType).toLowerCase();
    url = buildJdbcUrl(driverId, {
      host,
      port,
      database,
      oracleConnectType: connectType.includes("sid") ? "sid" : "service",
    });
  }

  if (!url.trim()) return null;
  return {
    name: stringValue(value.name, key) || "Imported DBeaver connection",
    driverId,
    url,
    user: stringValue(auth.userName, auth.user, configuration.user, value.user),
    catalog:
      driverId === "oracle" || driverId === "sqlite"
        ? ""
        : stringValue(configuration.database),
    defaultSchema: stringValue(configuration.schema, configuration.defaultSchema),
    showSystemObjects: false,
  };
}

function driverFromUrl(url: string): ConnectionDriverId | null {
  const match = /^jdbc:([a-z0-9]+):/i.exec(url.trim());
  if (!match) return null;
  switch (match[1].toLowerCase()) {
    case "oracle":
      return "oracle";
    case "sqlserver":
    case "mssql":
      return "sqlserver";
    case "mysql":
      return "mysql";
    case "mariadb":
      return "mariadb";
    case "postgresql":
    case "postgres":
      return "postgresql";
    case "sqlite":
      return "sqlite";
    default:
      return null;
  }
}

function driverFromDBeaver(provider: string): ConnectionDriverId | null {
  const normalized = provider.toLowerCase();
  if (normalized.includes("oracle")) return "oracle";
  if (normalized.includes("sqlserver") || normalized.includes("mssql")) return "sqlserver";
  if (normalized.includes("mariadb")) return "mariadb";
  if (normalized.includes("mysql")) return "mysql";
  if (normalized.includes("postgres") || normalized === "pg") return "postgresql";
  if (normalized.includes("sqlite")) return "sqlite";
  return null;
}

function childText(parent: Element, tagName: string): string {
  return parent.getElementsByTagName(tagName)[0]?.textContent?.trim() ?? "";
}

function stringValue(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
