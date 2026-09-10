import type { ConnectionDriverId } from "./connectionTypes";
import { formatTableReference } from "../query/sqlLiteral";
import type { CreateTableTarget } from "./createTableSql";

export type CreateRoutineKind = "procedure" | "function";

/** Dialect-valid initial text for the routine draft editor. */
export function defaultRoutineBody(
  driverId: ConnectionDriverId,
  kind: CreateRoutineKind,
): string {
  if (kind === "function") {
    return "BEGIN\n  RETURN 0;\nEND;";
  }
  if (driverId === "sqlserver") {
    return "BEGIN\n  SET NOCOUNT ON;\nEND;";
  }
  return "BEGIN\n  NULL;\nEND;";
}

/** SQLite has application-defined functions, not SQL DDL for stored routines. */
export function supportsRoutineCreation(driverId: ConnectionDriverId): boolean {
  return driverId !== "sqlite";
}

export function supportsPackageCreation(driverId: ConnectionDriverId): boolean {
  return driverId === "oracle";
}

/** Oracle packages have a public specification and a separate implementation body. */
export function buildCreatePackageSql(target: CreateTableTarget): string {
  const packageName = formatTableReference(
    target.schemaName,
    "NEW_PACKAGE",
    "oracle",
  );
  return [
    `CREATE OR REPLACE PACKAGE ${packageName} AS`,
    "  PROCEDURE NEW_PROCEDURE;",
    `END NEW_PACKAGE;`,
    "/",
    "",
    `CREATE OR REPLACE PACKAGE BODY ${packageName} AS`,
    "  PROCEDURE NEW_PROCEDURE IS",
    "  BEGIN",
    "    NULL;",
    "  END NEW_PROCEDURE;",
    `END NEW_PACKAGE;`,
    "/",
  ].join("\n");
}

export function buildCreateRoutineSql(
  driverId: ConnectionDriverId,
  target: CreateTableTarget,
  kind: CreateRoutineKind,
): string {
  const name = kind === "procedure" ? "NEW_PROCEDURE" : "NEW_FUNCTION";
  const routine = formatTableReference(
    target.schemaName,
    name,
    driverId,
    // SQL Server CREATE PROCEDURE/FUNCTION accepts schema.name only; the selected
    // database is applied to the JDBC session from the editor binding before execution.
    driverId === "sqlserver" ? undefined : target.catalogName,
  );

  switch (driverId) {
    case "oracle":
      return kind === "procedure"
        ? [
            `CREATE OR REPLACE PROCEDURE ${routine}`,
            "AS",
            "BEGIN",
            "  NULL;",
            "END;",
            "/",
          ].join("\n")
        : [
            `CREATE OR REPLACE FUNCTION ${routine}`,
            "RETURN NUMBER",
            "AS",
            "BEGIN",
            "  RETURN 0;",
            "END;",
            "/",
          ].join("\n");
    case "sqlserver":
      return kind === "procedure"
        ? [
            `CREATE PROCEDURE ${routine}`,
            "AS",
            "BEGIN",
            "  SET NOCOUNT ON;",
            "END;",
          ].join("\n")
        : [
            `CREATE FUNCTION ${routine} ()`,
            "RETURNS INT",
            "AS",
            "BEGIN",
            "  RETURN 0;",
            "END;",
          ].join("\n");
    case "postgresql":
      return kind === "procedure"
        ? [
            `CREATE OR REPLACE PROCEDURE ${routine}()`,
            "LANGUAGE plpgsql",
            "AS $$",
            "BEGIN",
            "  NULL;",
            "END;",
            "$$;",
          ].join("\n")
        : [
            `CREATE OR REPLACE FUNCTION ${routine}()`,
            "RETURNS INTEGER",
            "LANGUAGE plpgsql",
            "AS $$",
            "BEGIN",
            "  RETURN 0;",
            "END;",
            "$$;",
          ].join("\n");
    case "mysql":
    case "mariadb":
      return kind === "procedure"
        ? [
            `CREATE PROCEDURE ${routine}()`,
            "BEGIN",
            "  SELECT 1;",
            "END;",
          ].join("\n")
        : [
            `CREATE FUNCTION ${routine}()`,
            "RETURNS INT",
            "DETERMINISTIC",
            "RETURN 0;",
          ].join("\n");
    case "sqlite":
      throw new Error("SQLite does not support stored procedure or function DDL.");
  }
}
