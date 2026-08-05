import type { AiToolDefinition } from "./aiToolTypes";

/** Read-only DB tools for PL/SQL / object analysis (v1). */
export const AI_DB_TOOL_DEFINITIONS: readonly AiToolDefinition[] = [
  {
    name: "get_plsql_source",
    description:
      "Fetch the DDL/source of a stored PL/SQL object (procedure, function, or package spec/body) from the connected database.",
    parameters: {
      type: "object",
      properties: {
        schema: {
          type: "string",
          description: "Schema/owner name (e.g. HR).",
        },
        name: {
          type: "string",
          description: "Object name (e.g. PKG_ORDERS).",
        },
        kind: {
          type: "string",
          enum: ["procedure", "function", "package"],
          description: "Object kind.",
        },
        packageBody: {
          type: "boolean",
          description:
            "When kind is package: true for PACKAGE BODY, false/omit for PACKAGE (spec).",
        },
      },
      required: ["schema", "name", "kind"],
      additionalProperties: false,
    },
  },
  {
    name: "list_object_dependencies",
    description:
      "List compile-time dependencies (referenced tables, views, packages, etc.) for a stored object using database dictionary metadata.",
    parameters: {
      type: "object",
      properties: {
        schema: { type: "string" },
        name: { type: "string" },
        kind: {
          type: "string",
          enum: ["procedure", "function", "package"],
        },
        packageBody: {
          type: "boolean",
          description:
            "When kind is package: true for PACKAGE BODY, false/omit for PACKAGE (spec).",
        },
      },
      required: ["schema", "name", "kind"],
      additionalProperties: false,
    },
  },
  {
    name: "get_table_columns",
    description:
      "List columns (name and type) for a table or view in the connected database.",
    parameters: {
      type: "object",
      properties: {
        schema: { type: "string" },
        table: {
          type: "string",
          description: "Table or view name.",
        },
      },
      required: ["schema", "table"],
      additionalProperties: false,
    },
  },
  {
    name: "get_object_ddl",
    description:
      "Fetch DDL for a database object (table, view, procedure, function, or package).",
    parameters: {
      type: "object",
      properties: {
        schema: { type: "string" },
        name: { type: "string" },
        kind: {
          type: "string",
          enum: ["table", "view", "procedure", "function", "package"],
        },
        packageBody: {
          type: "boolean",
          description:
            "When kind is package: true for PACKAGE BODY, false/omit for PACKAGE (spec).",
        },
      },
      required: ["schema", "name", "kind"],
      additionalProperties: false,
    },
  },
] as const;
