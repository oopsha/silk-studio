import type { MetadataGroupId } from "@silk-studio/db-protocol";
import { I18nService } from "@silk-studio/workbench/platform/i18n/i18nService.ts";
import type { MessageKey } from "@silk-studio/workbench/platform/i18n/translate.ts";

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

const METADATA_GROUP_KEYS: Record<
  MetadataGroupId,
  { titleKey: MessageKey; icon: string }
> = {
  tables: { titleKey: "app.groups.tables", icon: "table" },
  views: { titleKey: "app.groups.views", icon: "symbol-interface" },
  packages: { titleKey: "app.groups.packages", icon: "package" },
  procedures: { titleKey: "app.groups.procedures", icon: "symbol-method" },
  functions: { titleKey: "app.groups.functions", icon: "symbol-function" },
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
  const def = METADATA_GROUP_KEYS[id];
  if (!def) {
    return { id, title: id, icon: "symbol-misc" };
  }
  return {
    id,
    title: I18nService.t(def.titleKey),
    icon: def.icon,
  };
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
