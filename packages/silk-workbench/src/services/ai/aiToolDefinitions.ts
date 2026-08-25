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
        connectionName: {
          type: "string",
          description:
            "Name of the connection profile to query (from find_object_by_name's matches, or the Explorer's connection display name). Omit only when there's just one connected profile or you're certain which one the user means.",
        },
        catalogName: {
          type: "string",
          description:
            "SQL Server only: which database/catalog on that connection (from find_object_by_name's catalogName). A schema like dbo exists identically-named in every database on a SQL Server connection, so without this the query may silently target the wrong database. Omit for dialects with no catalog concept (Oracle/PostgreSQL/MySQL/MariaDB).",
        },
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
        connectionName: {
          type: "string",
          description:
            "Name of the connection profile to query (from find_object_by_name's matches, or the Explorer's connection display name). Omit only when there's just one connected profile or you're certain which one the user means.",
        },
        catalogName: {
          type: "string",
          description:
            "SQL Server only: which database/catalog on that connection (from find_object_by_name's catalogName). A schema like dbo exists identically-named in every database on a SQL Server connection, so without this the query may silently target the wrong database. Omit for dialects with no catalog concept (Oracle/PostgreSQL/MySQL/MariaDB).",
        },
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
        connectionName: {
          type: "string",
          description:
            "Name of the connection profile to query (from find_object_by_name's matches, or the Explorer's connection display name). Omit only when there's just one connected profile or you're certain which one the user means.",
        },
        catalogName: {
          type: "string",
          description:
            "SQL Server only: which database/catalog on that connection (from find_object_by_name's catalogName). A schema like dbo exists identically-named in every database on a SQL Server connection, so without this the query may silently target the wrong database. Omit for dialects with no catalog concept (Oracle/PostgreSQL/MySQL/MariaDB).",
        },
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
        connectionName: {
          type: "string",
          description:
            "Name of the connection profile to query (from find_object_by_name's matches, or the Explorer's connection display name). Omit only when there's just one connected profile or you're certain which one the user means.",
        },
        catalogName: {
          type: "string",
          description:
            "SQL Server only: which database/catalog on that connection (from find_object_by_name's catalogName). A schema like dbo exists identically-named in every database on a SQL Server connection, so without this the query may silently target the wrong database. Omit for dialects with no catalog concept (Oracle/PostgreSQL/MySQL/MariaDB).",
        },
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
  {
    name: "find_object_by_name",
    description:
      "Find which connection AND schema (and, for SQL Server, which database) contains a table or view with this exact name, when you don't already know where it lives. Searches every schema/database on EVERY currently connected profile (not just the active one) via each database's own catalog/dictionary — a fast, read-only, fixed lookup (not arbitrary SQL, no execute permission needed). Only finds tables and views, not procedures/functions/packages. Returns zero, one, or several matches, each tagged with connectionName — the same name can exist on more than one connection and/or more than one schema. If there's more than one match, ask the user which one they mean rather than guessing; when you do know which one to use, pass its connectionName to open_object_editor.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Exact table or view name (case-sensitive per the database's own rules).",
        },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "open_object_editor",
    description:
      "Open a database object's editor tab in the workbench, landing on its Properties view (columns/DDL/etc. from already-fetched metadata). This never runs a query against the database — it's pure UI navigation, the same as double-clicking the object in the Explorer tree. It does NOT populate the object's Data tab (a live table/view content grid) — that requires the user to click the Data tab themselves, or you to separately propose a `SELECT * FROM <table>` SQL block for them to run.",
    parameters: {
      type: "object",
      properties: {
        connectionName: {
          type: "string",
          description:
            "Name of the connection profile to open this object from (the connectionName field from find_object_by_name's matches, or the connection's display name in the Explorer). Omit only when there's just one connected profile or you're certain which one the user means — otherwise omitting it falls back to whichever connection happens to be active, which may be the wrong one when several are connected.",
        },
        catalogName: {
          type: "string",
          description:
            "SQL Server only: which database/catalog on that connection (from find_object_by_name's catalogName). A schema like dbo exists identically-named in every database on a SQL Server connection — without this, the tab may open pointed at the wrong database and show no columns even though the object exists. Omit for dialects with no catalog concept (Oracle/PostgreSQL/MySQL/MariaDB).",
        },
        schema: { type: "string" },
        name: { type: "string" },
        kind: {
          type: "string",
          enum: ["table", "view", "procedure", "function", "package"],
        },
      },
      required: ["schema", "name", "kind"],
      additionalProperties: false,
    },
  },
] as const;
