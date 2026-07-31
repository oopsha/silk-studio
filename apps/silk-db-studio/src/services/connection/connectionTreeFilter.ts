import type { MetadataGroup, MetadataObject } from "@silk-studio/db-protocol";
import type {
  CatalogTreeNode,
  SchemaTreeNode,
} from "./connectionTreeService";

export function matchesTreeFilter(name: string, filter: string): boolean {
  const needle = filter.trim().toLowerCase();
  if (!needle) return true;
  return name.toLowerCase().includes(needle);
}

export type FilteredSchemaView = {
  schema: SchemaTreeNode;
  /** True when the schema row itself should stay visible under the current filter. */
  visible: boolean;
  /** True when the schema name matched (show all loaded objects). */
  schemaNameMatched: boolean;
  groups: Array<{
    group: MetadataGroup;
    objects: MetadataObject[];
  }>;
};

export type FilteredCatalogView = {
  catalog: CatalogTreeNode;
  visible: boolean;
  catalogNameMatched: boolean;
  schemas: FilteredSchemaView[];
};

/**
 * Client-side filter over currently loaded tree data.
 * Unloaded schemas only appear when their name matches.
 */
export function filterSchemaTree(
  schemas: SchemaTreeNode[],
  filter: string,
): FilteredSchemaView[] {
  const needle = filter.trim();
  if (!needle) {
    return schemas.map((schema) => ({
      schema,
      visible: true,
      schemaNameMatched: false,
      groups: schema.groups.map((group) => ({
        group,
        objects: group.objects,
      })),
    }));
  }

  return schemas.map((schema) => {
    const schemaNameMatched = matchesTreeFilter(schema.name, needle);

    if (schema.status !== "loaded") {
      return {
        schema,
        visible: schemaNameMatched,
        schemaNameMatched,
        groups: [],
      };
    }

    if (schemaNameMatched) {
      return {
        schema,
        visible: true,
        schemaNameMatched: true,
        groups: schema.groups.map((group) => ({
          group,
          objects: group.objects,
        })),
      };
    }

    const groups = schema.groups
      .map((group) => ({
        group,
        objects: group.objects.filter((object) =>
          matchesTreeFilter(object.name, needle),
        ),
      }))
      .filter((entry) => entry.objects.length > 0);

    return {
      schema,
      visible: groups.length > 0,
      schemaNameMatched: false,
      groups,
    };
  });
}

export function filterCatalogTree(
  catalogs: CatalogTreeNode[],
  filter: string,
): FilteredCatalogView[] {
  const needle = filter.trim();
  return catalogs.map((catalog) => {
    const catalogNameMatched = matchesTreeFilter(catalog.name, needle);
    const schemas = filterSchemaTree(catalog.schemas, filter);
    const anySchemaVisible = schemas.some((entry) => entry.visible);

    if (!needle) {
      return {
        catalog,
        visible: true,
        catalogNameMatched: false,
        schemas,
      };
    }

    if (catalogNameMatched) {
      return {
        catalog,
        visible: true,
        catalogNameMatched: true,
        schemas: filterSchemaTree(catalog.schemas, ""),
      };
    }

    return {
      catalog,
      visible: anySchemaVisible,
      catalogNameMatched: false,
      schemas,
    };
  });
}
