import type { MetadataObjectKind } from "@silk-studio/db-protocol";
import type { ConnectionDriverId } from "./connectionTypes";
import { formatTableReference, quoteIdentifier } from "../query/sqlLiteral";

export type ObjectMutationContext = {
  schemaName: string;
  objectName: string;
  kind: MetadataObjectKind;
  driverId: ConnectionDriverId;
};

function qualifiedObject(
  ctx: ObjectMutationContext,
): string {
  return formatTableReference(ctx.schemaName, ctx.objectName, ctx.driverId);
}

function dropKeyword(kind: MetadataObjectKind): string {
  switch (kind) {
    case "table":
      return "TABLE";
    case "view":
      return "VIEW";
    case "procedure":
      return "PROCEDURE";
    case "function":
      return "FUNCTION";
    case "package":
      return "PACKAGE";
    case "index":
      return "INDEX";
    case "sequence":
      return "SEQUENCE";
    case "synonym":
      return "SYNONYM";
    case "trigger":
      return "TRIGGER";
    case "type":
      return "TYPE";
    default:
      return "TABLE";
  }
}

/** Kinds added for read-only listing (v1) — drop/rename syntax varies too much per driver to enable yet. */
function isListingOnlyKind(kind: MetadataObjectKind): boolean {
  return (
    kind === "index" ||
    kind === "sequence" ||
    kind === "synonym" ||
    kind === "trigger" ||
    kind === "type"
  );
}

export function supportsDropObject(
  kind: MetadataObjectKind,
  driverId: ConnectionDriverId,
): boolean {
  if (isListingOnlyKind(kind)) {
    return false;
  }
  if (kind === "package") {
    return driverId === "oracle";
  }
  return true;
}

/** SQLite supports the safe native ALTER subset; rebuild-only changes stay blocked at save time. */
const TABLE_STRUCTURE_EDIT_DRIVERS = new Set<ConnectionDriverId>([
  "oracle",
  "postgresql",
  "mysql",
  "mariadb",
  "sqlserver",
  "sqlite",
]);

export function supportsTableStructureEdit(
  driverId: ConnectionDriverId,
  kind: MetadataObjectKind,
): boolean {
  return kind === "table" && TABLE_STRUCTURE_EDIT_DRIVERS.has(driverId);
}

/** Native rename support intentionally stays limited to object kinds with verified SQL. */
export function supportsRenameObject(
  kind: MetadataObjectKind,
  driverId: ConnectionDriverId,
): boolean {
  if (isListingOnlyKind(kind)) {
    return false;
  }
  if (driverId === "oracle") {
    return true;
  }
  if (driverId === "postgresql") {
    return kind === "table" || kind === "view";
  }
  if (driverId === "sqlserver") {
    return kind === "table";
  }
  return false;
}

export function buildDropObjectSql(ctx: ObjectMutationContext): string {
  const qualified = qualifiedObject(ctx);
  const keyword = dropKeyword(ctx.kind);

  switch (ctx.driverId) {
    case "postgresql":
      return `DROP ${keyword} IF EXISTS ${qualified}`;
    case "sqlserver":
      return `DROP ${keyword} ${qualified}`;
    default:
      return `DROP ${keyword} ${qualified}`;
  }
}

export function buildRenameObjectSql(
  ctx: ObjectMutationContext,
  newName: string,
): string {
  const trimmed = newName.trim();
  if (!trimmed) {
    throw new Error("New name is required.");
  }
  if (trimmed === ctx.objectName) {
    throw new Error("New name must be different from the current name.");
  }
  if (!/^[\w$#]+$/i.test(trimmed)) {
    throw new Error(
      "New name may only contain letters, numbers, underscore, $, and #.",
    );
  }

  const schema = quoteIdentifier(ctx.schemaName, ctx.driverId);
  const oldName = quoteIdentifier(ctx.objectName, ctx.driverId);
  const nextName = quoteIdentifier(trimmed, ctx.driverId);
  const qualified = `${schema}.${oldName}`;

  if (ctx.driverId === "oracle") {
    switch (ctx.kind) {
      case "table":
        return `ALTER TABLE ${qualified} RENAME TO ${nextName}`;
      case "view":
        return `RENAME ${ctx.objectName} TO ${trimmed}`;
      case "procedure":
        return `ALTER PROCEDURE ${qualified} RENAME TO ${nextName}`;
      case "function":
        return `ALTER FUNCTION ${qualified} RENAME TO ${nextName}`;
      case "package":
        return `ALTER PACKAGE ${qualified} RENAME TO ${nextName}`;
      default:
        throw new Error(`Rename is not supported for ${ctx.kind}.`);
    }
  }

  if (ctx.driverId === "postgresql") {
    switch (ctx.kind) {
      case "table":
        return `ALTER TABLE ${qualified} RENAME TO ${nextName}`;
      case "view":
        return `ALTER VIEW ${qualified} RENAME TO ${nextName}`;
      default:
        throw new Error(
          "PostgreSQL rename is only supported for tables and views in v1.",
        );
    }
  }

  if (ctx.driverId === "sqlserver") {
    if (ctx.kind !== "table") {
      throw new Error(
        "SQL Server rename is only supported for tables.",
      );
    }
    // sp_rename only permits objects in the current database. The mutation service switches
    // the JDBC session to ref.catalogName before this statement when necessary.
    return `EXEC sys.sp_rename @objname = N'${schema}.${oldName}', @newname = N'${trimmed}', @objtype = N'OBJECT'`;
  }

  throw new Error("Rename is not supported for this database driver.");
}

export function mutationContextFromRef(
  ref: {
    schemaName: string;
    object: { name: string; kind: MetadataObjectKind };
  },
  driverId: ConnectionDriverId,
): ObjectMutationContext {
  return {
    schemaName: ref.schemaName,
    objectName: ref.object.name,
    kind: ref.object.kind,
    driverId,
  };
}
