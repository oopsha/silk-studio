import type { ConnectionDriverId } from "./connectionTypes";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Removes only the selected object's own schema qualifier. Qualifiers on references to other
 * schemas stay intact so the copied DDL does not silently change its dependencies.
 */
export function withDdlSchemaQualification(
  ddl: string,
  schemaName: string,
  driverId: ConnectionDriverId | undefined,
  includeSchema: boolean,
): string {
  if (includeSchema || !schemaName.trim()) return ddl;

  const schema = schemaName.trim();
  const quotedSchema =
    driverId === "sqlserver"
      ? "[" + schema.replace(/\]/g, "]]") + "]"
      : driverId === "mysql" || driverId === "mariadb"
        ? `\`${schema.replace(/`/g, "``")}\``
        : `"${schema.replace(/"/g, '""')}"`;

  return ddl.replace(new RegExp(`${escapeRegExp(quotedSchema)}\\.`, "gi"), "");
}
