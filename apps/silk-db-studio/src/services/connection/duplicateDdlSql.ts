import { formatTableReference } from "../query/sqlLiteral";
import type { ConnectionDriverId } from "./connectionTypes";

/** Replaces only the identifier in a leading CREATE statement, retaining parameters and source. */
export function renameCreateDdl(ddl: string, kind: "procedure" | "function" | "package", schemaName: string, name: string, driverId: ConnectionDriverId, catalogName?: string | null): string {
  const keyword = kind === "package" ? "PACKAGE(?:\\s+BODY)?" : kind.toUpperCase();
  const identifier = "(?:\\[[^\\]]+\\]|\"[^\"]+\"|[\\w$#]+)";
  const pattern = new RegExp(`^(\\s*CREATE\\s+(?:OR\\s+(?:REPLACE|ALTER)\\s+)?${keyword}\\s+)(?:${identifier}\\s*\\.\\s*)?${identifier}`, "i");
  const reference = formatTableReference(schemaName, name, driverId, driverId === "sqlserver" ? undefined : catalogName);
  if (!pattern.test(ddl)) throw new Error("복제할 정의의 CREATE 헤더를 찾을 수 없습니다.");
  return ddl.replace(pattern, `$1${reference}`);
}
