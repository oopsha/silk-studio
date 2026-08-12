import type { MetadataObject, MetadataObjectKind } from "@silk-studio/db-protocol";
import { getMetadataGroupDefinition } from "./metadataGroups";
import type { SchemaTreeNode } from "./connectionTreeService";
import { matchesTreeFilter } from "./connectionTreeFilter";

export type ExplorerObjectSearchPick = {
  type: "object";
  id: string;
  label: string;
  description: string;
  icon: string;
  profileId: string;
  schemaName: string;
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
};

export type ExplorerSearchPick =
  | ExplorerObjectSearchPick
  | ExplorerLoadSchemaSearchPick;

const MAX_OBJECT_PICKS = 100;
const MAX_LOAD_SCHEMA_PICKS = 20;

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

/**
 * Build Quick Pick items from the explorer tree cache.
 * Unloaded schemas that match the filter become "Load schema…" actions.
 */
export function buildExplorerSearchPicks(
  profileId: string,
  schemas: SchemaTreeNode[],
  filter: string,
): ExplorerSearchPick[] {
  const needle = filter.trim();
  const objects: ExplorerObjectSearchPick[] = [];
  const loadSchemas: ExplorerLoadSchemaSearchPick[] = [];

  for (const schema of schemas) {
    if (schema.status === "loaded") {
      for (const group of schema.groups) {
        for (const object of group.objects) {
          if (
            needle &&
            !matchesTreeFilter(object.name, needle) &&
            !matchesTreeFilter(`${schema.name}.${object.name}`, needle)
          ) {
            continue;
          }
          objects.push({
            type: "object",
            id: `object:${profileId}:${schema.name}:${object.kind}:${object.name}`,
            label: object.name,
            description: `${schema.name} · ${kindLabel(object.kind)}`,
            icon: iconForKind(object.kind),
            profileId,
            schemaName: schema.name,
            object,
          });
          if (objects.length >= MAX_OBJECT_PICKS) {
            break;
          }
        }
        if (objects.length >= MAX_OBJECT_PICKS) {
          break;
        }
      }
    } else if (
      (needle && matchesTreeFilter(schema.name, needle)) ||
      (!needle && schema.status !== "loading")
    ) {
      loadSchemas.push({
        type: "loadSchema",
        id: `load:${profileId}:${schema.name}`,
        label: schema.name,
        description:
          schema.status === "loading"
            ? "Loading…"
            : schema.status === "error"
              ? schema.errorMessage ?? "Failed to load — retry"
              : "Load schema to search objects…",
        icon: "database",
        profileId,
        schemaName: schema.name,
      });
    }

    if (objects.length >= MAX_OBJECT_PICKS) {
      break;
    }
  }

  // Prefer object hits; only keep load-schema picks when filtering by schema
  // name or when nothing is loaded yet.
  const includeLoadSchemas =
    Boolean(needle) || objects.length === 0;

  objects.sort((a, b) => {
    const byLabel = a.label.localeCompare(b.label);
    if (byLabel !== 0) return byLabel;
    return a.description.localeCompare(b.description);
  });

  loadSchemas.sort((a, b) => a.label.localeCompare(b.label));

  return [
    ...objects.slice(0, MAX_OBJECT_PICKS),
    ...(includeLoadSchemas
      ? loadSchemas.slice(0, MAX_LOAD_SCHEMA_PICKS)
      : []),
  ];
}
