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

/** All 5 drivers support the table structure editor (Columns tab of Properties) for tables. */
const TABLE_STRUCTURE_EDIT_DRIVERS = new Set<ConnectionDriverId>([
  "oracle",
  "postgresql",
  "mysql",
  "mariadb",
  "sqlserver",
]);

export function supportsTableStructureEdit(
  driverId: ConnectionDriverId,
  kind: MetadataObjectKind,
): boolean {
  return kind === "table" && TABLE_STRUCTURE_EDIT_DRIVERS.has(driverId);
}

/** v1 rename: PostgreSQL (table/view) and Oracle (all explorer kinds). */
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
