import type { MetadataGroupId } from "@silk-studio/db-protocol";

/**
 * Display metadata for an Explorer object group. The jdbc-agent only decides *which* group ids
 * are present for a given database (via `DbDialect.supportedGroups()`); label and icon are
 * owned here on the frontend so they can change without touching the Java agent.
 */
export type MetadataGroupDefinition = {
  id: MetadataGroupId;
  title: string;
  icon: string;
};

const METADATA_GROUP_DEFINITIONS: Record<MetadataGroupId, MetadataGroupDefinition> = {
  tables: { id: "tables", title: "Tables", icon: "table" },
  views: { id: "views", title: "Views", icon: "symbol-interface" },
  packages: { id: "packages", title: "Packages", icon: "package" },
  procedures: { id: "procedures", title: "Procedures", icon: "symbol-method" },
  functions: { id: "functions", title: "Functions", icon: "symbol-function" },
};

/** Controls the order groups render in the Explorer, independent of jdbc-agent response order. */
export const METADATA_GROUP_ORDER: MetadataGroupId[] = [
  "tables",
  "views",
  "packages",
  "procedures",
  "functions",
];

export function getMetadataGroupDefinition(
  id: MetadataGroupId,
): MetadataGroupDefinition {
  return (
    METADATA_GROUP_DEFINITIONS[id] ?? {
      id,
      title: id,
      icon: "symbol-misc",
    }
  );
}

/** Sorts groups per `METADATA_GROUP_ORDER`; unknown ids sort last, in their original order. */
export function sortMetadataGroups<T extends { id: MetadataGroupId }>(
  groups: T[],
): T[] {
  return [...groups].sort((a, b) => {
    const aIndex = METADATA_GROUP_ORDER.indexOf(a.id);
    const bIndex = METADATA_GROUP_ORDER.indexOf(b.id);
    return (
      (aIndex === -1 ? METADATA_GROUP_ORDER.length : aIndex) -
      (bIndex === -1 ? METADATA_GROUP_ORDER.length : bIndex)
    );
  });
}
