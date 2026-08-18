import type { MetadataObject, MetadataObjectKind } from "@silk-studio/db-protocol";
import { getMetadataGroupDefinition } from "./metadataGroups";
import type { ProfileTreeCache, SchemaTreeNode } from "./connectionTreeService";
import { matchesTreeFilter } from "./connectionTreeFilter";

export type ExplorerObjectSearchPick = {
  type: "object";
  id: string;
  label: string;
  description: string;
  icon: string;
  profileId: string;
  schemaName: string;
  catalogName?: string;
  object: MetadataObject;
};

export type ExplorerLoadSchemaSearchPick = {
  type: "loadSchema";
  id: string;
  label: string;
  description: string;
  icon: string;
  profileId: string;
  schemaName: string;
  catalogName?: string;
};

export type ExplorerLoadCatalogSearchPick = {
  type: "loadCatalog";
  id: string;
  label: string;
  description: string;
  icon: string;
  profileId: string;
  catalogName: string;
};

export type ExplorerSearchPick =
  | ExplorerObjectSearchPick
  | ExplorerLoadSchemaSearchPick
  | ExplorerLoadCatalogSearchPick;

const MAX_OBJECT_PICKS = 100;
const MAX_LOAD_SCHEMA_PICKS = 20;
const MAX_LOAD_CATALOG_PICKS = 20;

/**
 * Ctrl+Shift+O is object *navigation* (open data/DDL), not a full metadata browser — so even
 * when a schema's cache happens to hold indexes/sequences/synonyms/triggers/types (e.g. it was
 * fully loaded via Explorer's manual "expand schema" before this search ran), those kinds are
 * filtered out of the picks. Keeps results consistent regardless of how a schema got cached.
 */
const SEARCHABLE_KINDS: ReadonlySet<MetadataObjectKind> = new Set([
  "table",
  "view",
  "package",
  "procedure",
  "function",
]);

function kindLabel(kind: MetadataObjectKind): string {
  switch (kind) {
    case "table":
      return "Table";
    case "view":
      return "View";
    case "package":
      return "Package";
    case "procedure":
      return "Procedure";
    case "function":
      return "Function";
    case "index":
      return "Index";
    case "sequence":
      return "Sequence";
    case "synonym":
      return "Synonym";
    case "trigger":
      return "Trigger";
    case "type":
      return "Type";
    default:
      return kind;
  }
}

function iconForKind(kind: MetadataObjectKind): string {
  switch (kind) {
    case "table":
      return getMetadataGroupDefinition("tables").icon;
    case "view":
      return getMetadataGroupDefinition("views").icon;
    case "package":
      return getMetadataGroupDefinition("packages").icon;
    case "procedure":
      return getMetadataGroupDefinition("procedures").icon;
    case "function":
      return getMetadataGroupDefinition("functions").icon;
    case "index":
      return getMetadataGroupDefinition("indexes").icon;
    case "sequence":
      return getMetadataGroupDefinition("sequences").icon;
    case "synonym":
      return getMetadataGroupDefinition("synonyms").icon;
    case "trigger":
      return getMetadataGroupDefinition("triggers").icon;
    case "type":
      return getMetadataGroupDefinition("types").icon;
    default:
      return "symbol-misc";
  }
}

function matchesObject(
  needle: string,
  catalogName: string | undefined,
  schemaName: string,
  objectName: string,
): boolean {
  if (!needle) return true;
  if (matchesTreeFilter(objectName, needle)) return true;
  if (matchesTreeFilter(`${schemaName}.${objectName}`, needle)) return true;
  if (catalogName && matchesTreeFilter(`${catalogName}.${schemaName}.${objectName}`, needle)) {
    return true;
  }
  return false;
}

function withProfilePrefix(description: string, profileLabel: string | undefined): string {
  return profileLabel ? `[${profileLabel}] ${description}` : description;
}

/** Appends object/load-schema picks for one catalog's (or the flat, catalog-less) schema list. */
function collectFromSchemas(
  profileId: string,
  profileLabel: string | undefined,
  schemas: SchemaTreeNode[],
  needle: string,
  catalogName: string | undefined,
  objects: ExplorerObjectSearchPick[],
  loadSchemas: ExplorerLoadSchemaSearchPick[],
): void {
  for (const schema of schemas) {
    if (objects.length >= MAX_OBJECT_PICKS) return;

    if (schema.status === "loaded") {
      for (const group of schema.groups) {
        for (const object of group.objects) {
          if (!SEARCHABLE_KINDS.has(object.kind)) continue;
          if (!matchesObject(needle, catalogName, schema.name, object.name)) continue;
          objects.push({
            type: "object",
            id: `object:${profileId}:${catalogName ?? ""}:${schema.name}:${object.kind}:${object.name}`,
            label: object.name,
            description: withProfilePrefix(
              catalogName
                ? `${catalogName}.${schema.name} · ${kindLabel(object.kind)}`
                : `${schema.name} · ${kindLabel(object.kind)}`,
              profileLabel,
            ),
            icon: iconForKind(object.kind),
            profileId,
            schemaName: schema.name,
            catalogName,
            object,
          });
          if (objects.length >= MAX_OBJECT_PICKS) return;
        }
      }
    } else if (
      (needle && matchesTreeFilter(schema.name, needle)) ||
      (!needle && schema.status !== "loading")
    ) {
      loadSchemas.push({
        type: "loadSchema",
        id: `load:${profileId}:${catalogName ?? ""}:${schema.name}`,
        label: catalogName ? `${catalogName}.${schema.name}` : schema.name,
        description: withProfilePrefix(
          schema.status === "loading"
            ? "Loading…"
            : schema.status === "error"
              ? (schema.errorMessage ?? "Failed to load — retry")
              : "Not indexed yet — click to load this schema's objects for search",
          profileLabel,
        ),
        icon: "database",
        profileId,
        schemaName: schema.name,
        catalogName,
      });
    }
  }
}

/**
 * Build Quick Pick items from one profile's explorer tree cache — every catalog (not just the
 * current one), so `db.schema.object` / `schema.object` / bare object name all resolve
 * regardless of which database is "current" on the session. Catalogs/schemas never loaded yet
 * become "Load…" actions instead of being silently skipped. `profileLabel`, when given, is
 * prefixed onto every description (used when merging results across multiple connections —
 * see {@link buildExplorerSearchPicksAcrossProfiles}).
 */
export function buildExplorerSearchPicks(
  profileId: string,
  cache: ProfileTreeCache,
  filter: string,
  profileLabel?: string,
): ExplorerSearchPick[] {
  const needle = filter.trim();
  const objects: ExplorerObjectSearchPick[] = [];
  const loadSchemas: ExplorerLoadSchemaSearchPick[] = [];
  const loadCatalogs: ExplorerLoadCatalogSearchPick[] = [];

  if (cache.catalogs.length === 0) {
    collectFromSchemas(
      profileId,
      profileLabel,
      cache.schemas,
      needle,
      undefined,
      objects,
      loadSchemas,
    );
  } else {
    for (const catalog of cache.catalogs) {
      if (objects.length >= MAX_OBJECT_PICKS) break;
      if (catalog.status === "loaded" || catalog.status === "loading") {
        collectFromSchemas(
          profileId,
          profileLabel,
          catalog.schemas,
          needle,
          catalog.name,
          objects,
          loadSchemas,
        );
      }
      if (
        catalog.status !== "loaded" &&
        ((needle && matchesTreeFilter(catalog.name, needle)) ||
          (!needle && catalog.status !== "loading"))
      ) {
        loadCatalogs.push({
          type: "loadCatalog",
          id: `loadCatalog:${profileId}:${catalog.name}`,
          label: catalog.name,
          description: withProfilePrefix(
            catalog.status === "loading"
              ? "Loading…"
              : catalog.status === "error"
                ? (catalog.errorMessage ?? "Failed to load — retry")
                : "Not indexed yet — click to load this database for search",
            profileLabel,
          ),
          icon: "database",
          profileId,
          catalogName: catalog.name,
        });
      }
    }
  }

  // Prefer object hits; only keep load-* picks when filtering by name or when nothing loaded yet.
  const includeLoadPicks = Boolean(needle) || objects.length === 0;

  return [
    ...objects.slice(0, MAX_OBJECT_PICKS),
    ...(includeLoadPicks ? loadSchemas.slice(0, MAX_LOAD_SCHEMA_PICKS) : []),
    ...(includeLoadPicks ? loadCatalogs.slice(0, MAX_LOAD_CATALOG_PICKS) : []),
  ];
}

/**
 * Merges {@link buildExplorerSearchPicks} across every connected profile so Ctrl+Shift+O finds
 * an object regardless of which connection it lives on — not just the one bound to the active
 * editor tab. Each profile's picks are prefixed with its connection name once more than one
 * profile is connected, so results stay disambiguated.
 */
export function buildExplorerSearchPicksAcrossProfiles(
  profiles: readonly { profileId: string; cache: ProfileTreeCache; label: string }[],
  filter: string,
): ExplorerSearchPick[] {
  const showLabels = profiles.length > 1;
  const objects: ExplorerObjectSearchPick[] = [];
  const loadSchemas: ExplorerLoadSchemaSearchPick[] = [];
  const loadCatalogs: ExplorerLoadCatalogSearchPick[] = [];

  for (const { profileId, cache, label } of profiles) {
    const picks = buildExplorerSearchPicks(
      profileId,
      cache,
      filter,
      showLabels ? label : undefined,
    );
    for (const pick of picks) {
      if (pick.type === "object") objects.push(pick);
      else if (pick.type === "loadSchema") loadSchemas.push(pick);
      else loadCatalogs.push(pick);
    }
  }

  objects.sort((a, b) => {
    const byLabel = a.label.localeCompare(b.label);
    if (byLabel !== 0) return byLabel;
    return a.description.localeCompare(b.description);
  });
  loadSchemas.sort((a, b) => a.label.localeCompare(b.label));
  loadCatalogs.sort((a, b) => a.label.localeCompare(b.label));

  return [
    ...objects.slice(0, MAX_OBJECT_PICKS),
    ...loadSchemas.slice(0, MAX_LOAD_SCHEMA_PICKS),
    ...loadCatalogs.slice(0, MAX_LOAD_CATALOG_PICKS),
  ];
}
