package com.silk.jdbcagent;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Official MySQL Connector/J dialect. MySQL has no schema concept distinct from the database
 * (catalog) — {@code CREATE SCHEMA} is a synonym for {@code CREATE DATABASE} — so each database
 * the user can see is surfaced as one browsable "schema" node, matching the multi-jdbc-rollout
 * plan's "database를 catalog/기본 namespace로 사용" requirement. The frontend keeps `catalog` and
 * `defaultSchema` in sync for this driver (see {@code ConnectionDriverDefinition.showSchemaField}
 * in connectionTypes.ts) so this dialect only needs to care about `catalog`.
 */
final class MySqlDialect implements DbDialect {
  @Override
  public String id() {
    return "mysql";
  }

  @Override
  public boolean matchesUrl(String normalizedUrl) {
    return normalizedUrl.startsWith("jdbc:mysql:");
  }

  @Override
  public void testConnection(Connection connection, int timeoutSeconds) throws SQLException {
    runTestQuery(connection, timeoutSeconds, "SELECT 1");
  }

  @Override
  public void afterConnect(Connection connection, JsonNode params) throws SQLException {
    String catalog = params.path("catalog").asText("").trim();
    if (!catalog.isEmpty()) {
      // Equivalent to `USE catalog`; MySQL treats catalog and "current database" as the same
      // thing, so this alone picks the default namespace for unqualified queries.
      connection.setCatalog(catalog);
    }
  }

  @Override
  public List<MetadataGroupId> supportedGroups() {
    // No PACKAGE concept on MySQL.
    return List.of(
        MetadataGroupId.TABLES,
        MetadataGroupId.VIEWS,
        MetadataGroupId.PROCEDURES,
        MetadataGroupId.FUNCTIONS);
  }

  @Override
  public List<String> listSchemaNames(Connection connection) throws SQLException {
    Set<String> names = new LinkedHashSet<>();
    // MySQL Connector/J reports databases via getCatalogs() (TABLE_CAT); getSchemas() is
    // effectively unused for MySQL.
    try (ResultSet catalogs = connection.getMetaData().getCatalogs()) {
      while (catalogs.next()) {
        String name = catalogs.getString("TABLE_CAT");
        if (name != null && !name.isBlank()) {
          names.add(name);
        }
      }
    }

    if (names.isEmpty()) {
      String currentCatalog = connection.getCatalog();
      if (currentCatalog != null && !currentCatalog.isBlank()) {
        names.add(currentCatalog);
      }
    }

    return new ArrayList<>(names);
  }

  @Override
  public void collectSchemaObjects(Connection connection, String schemaName, ArrayNode objects)
      throws SQLException {
    // `schemaName` here is a MySQL database name; pass it as the JDBC catalog and leave the
    // schema pattern null (MySQL has no separate schema level).
    DatabaseMetaData metadata = connection.getMetaData();

    try (ResultSet tables =
        metadata.getTables(schemaName, null, "%", new String[] {"TABLE", "VIEW"})) {
      while (tables.next()) {
        String name = tables.getString("TABLE_NAME");
        String type = tables.getString("TABLE_TYPE");
        if (name == null || name.isBlank()) {
          continue;
        }
        ObjectNode object = objects.addObject();
        object.put("name", name);
        object.put(
            "kind", type != null && type.toUpperCase(Locale.ROOT).contains("VIEW") ? "view" : "table");
      }
    }

    try (ResultSet procedures = metadata.getProcedures(schemaName, null, "%")) {
      while (procedures.next()) {
        String name = procedures.getString("PROCEDURE_NAME");
        if (name == null || name.isBlank()) {
          continue;
        }
        ObjectNode object = objects.addObject();
        object.put("name", name);
        object.put("kind", "procedure");
      }
    }

    // getFunctions (JDBC 4.0+) reports MySQL stored functions separately from getProcedures.
    try (ResultSet functions = metadata.getFunctions(schemaName, null, "%")) {
      while (functions.next()) {
        String name = functions.getString("FUNCTION_NAME");
        if (name == null || name.isBlank()) {
          continue;
        }
        ObjectNode object = objects.addObject();
        object.put("name", name);
        object.put("kind", "function");
      }
    }

    // MySQL has no PACKAGE concept; nothing to add for the "package" kind.
  }
}
