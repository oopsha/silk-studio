import type { ConnectionDriverId } from "./connectionTypes";
import { formatTableReference } from "../query/sqlLiteral";
import type { CreateTableTarget } from "./createTableSql";

export type CreateRoutineKind = "procedure" | "function";

/** Dialect-valid initial text for the routine draft editor. */
export function defaultRoutineBody(driverId: ConnectionDriverId, kind: CreateRoutineKind): string {
  if (kind === "function") return "BEGIN\n  RETURN 0;\nEND;";
  if (driverId === "sqlserver") return "BEGIN\n  SET NOCOUNT ON;\nEND;";
  if (driverId === "mysql" || driverId === "mariadb") return "BEGIN\n  SELECT 1;\nEND;";
  return "BEGIN\n  NULL;\nEND;";
}

export function supportsRoutineCreation(driverId: ConnectionDriverId): boolean {
  return driverId !== "sqlite";
}

export function supportsPackageCreation(driverId: ConnectionDriverId): boolean {
  return driverId === "oracle";
}

export function buildCreatePackageSql(target: CreateTableTarget): string {
  const packageName = formatTableReference(target.schemaName, "NEW_PACKAGE", "oracle");
  return [
    `CREATE OR REPLACE PACKAGE ${packageName} AS`,
    "  PROCEDURE NEW_PROCEDURE;",
    "END NEW_PACKAGE;",
    "/",
    "",
    `CREATE OR REPLACE PACKAGE BODY ${packageName} AS`,
    "  PROCEDURE NEW_PROCEDURE IS",
    "  BEGIN",
    "    NULL;",
    "  END NEW_PROCEDURE;",
    "END NEW_PACKAGE;",
    "/",
  ].join("\n");
}

function routineReference(driverId: ConnectionDriverId, target: CreateTableTarget, name: string): string {
  return formatTableReference(
    target.schemaName,
    name,
    driverId,
    driverId === "sqlserver" ? undefined : target.catalogName,
  );
}

/** Builds a routine using the editor's body without dialect-unsafe regex replacement. */
export function buildCreateRoutineDraftSql(
  driverId: ConnectionDriverId,
  target: CreateTableTarget,
  kind: CreateRoutineKind,
  name: string,
  body: string,
): string {
  const routine = routineReference(driverId, target, name);
  const text = body.trim();
  switch (driverId) {
    case "oracle":
      return [
        `CREATE OR REPLACE ${kind === "procedure" ? "PROCEDURE" : "FUNCTION"} ${routine}`,
        ...(kind === "function" ? ["RETURN NUMBER"] : []),
        "AS",
        text,
        "/",
      ].join("\n");
    case "sqlserver":
      return [
        `CREATE ${kind === "procedure" ? "PROCEDURE" : "FUNCTION"} ${routine}${kind === "function" ? " ()" : ""}`,
        ...(kind === "function" ? ["RETURNS INT"] : []),
        "AS",
        text,
      ].join("\n");
    case "postgresql":
      return [
        `CREATE OR REPLACE ${kind === "procedure" ? "PROCEDURE" : "FUNCTION"} ${routine}()`,
        ...(kind === "function" ? ["RETURNS INTEGER"] : []),
        "LANGUAGE plpgsql",
        "AS $$",
        text,
        "$$;",
      ].join("\n");
    case "mysql":
    case "mariadb":
      return kind === "procedure"
        ? [`CREATE PROCEDURE ${routine}()`, text].join("\n")
        : [`CREATE FUNCTION ${routine}()`, "RETURNS INT", "DETERMINISTIC", text].join("\n");
    case "sqlite":
      throw new Error("SQLite does not support stored procedure or function DDL.");
  }
}

export function buildCreateRoutineSql(
  driverId: ConnectionDriverId,
  target: CreateTableTarget,
  kind: CreateRoutineKind,
): string {
  const name = kind === "procedure" ? "NEW_PROCEDURE" : "NEW_FUNCTION";
  return buildCreateRoutineDraftSql(
    driverId,
    target,
    kind,
    name,
    defaultRoutineBody(driverId, kind),
  );
}
