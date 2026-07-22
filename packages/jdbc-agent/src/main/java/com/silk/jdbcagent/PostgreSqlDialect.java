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
 * Official PostgreSQL JDBC Driver (pgJDBC) dialect. Database (JDBC catalog) is selected at
 * connect time from the URL path ({@code jdbc:postgresql://host:5432/dbname}) — pgJDBC's
 * {@link Connection#setCatalog} is a no-op — so this dialect only applies an optional default
 * schema via {@code SET search_path}. No PACKAGE concept.
 */
final class PostgreSqlDialect implements DbDialect {
  @Override
  public String id() {
    return "postgresql";
  }

  @Override
  public boolean matchesUrl(String normalizedUrl) {
    return normalizedUrl.startsWith("jdbc:postgresql:");
  }

  @Override
  public void testConnection(Connection connection, int timeoutSeconds) throws SQLException {
    runTestQuery(connection, timeoutSeconds, "SELECT 1");
  }

  @Override
  public void afterConnect(Connection connection, JsonNode params) throws SQLException {
    // Database/catalog is chosen by the URL; pgJDBC does not switch databases via setCatalog.
    String schema = params.path("schema").asText("").trim();
    if (schema.isEmpty()) {
      return;
    }
    // Quote as a delimited identifier so mixed-case / reserved names work, and keep `public` as
    // a fallback so unqualified lookups still resolve common objects when the chosen schema
    // doesn't contain them (matches typical PostgreSQL client tooling).
    String quoted = "\"" + schema.replace("\"", "\"\"") + "\"";
    try (Statement statement = connection.createStatement()) {
      statement.execute("SET search_path TO " + quoted + ", public");
    }
  }

  @Override
  public List<MetadataGroupId> supportedGroups() {
    // No PACKAGE concept on PostgreSQL.
    return List.of(
        MetadataGroupId.TABLES,
        MetadataGroupId.VIEWS,
        MetadataGroupId.PROCEDURES,
        MetadataGroupId.FUNCTIONS);
  }

  @Override
  public List<String> listSchemaNames(Connection connection) throws SQLException {
    String catalog = connection.getCatalog();
    Set<String> names = new LinkedHashSet<>();
    try (ResultSet schemas = connection.getMetaData().getSchemas(catalog, null)) {
      while (schemas.next()) {
        String name = schemas.getString("TABLE_SCHEM");
        if (name != null && !name.isBlank()) {
          names.add(name);
        }
      }
    }

    if (names.isEmpty()) {
      try (Statement statement = connection.createStatement();
          ResultSet rs = statement.executeQuery("SELECT current_schema()")) {
        if (rs.next()) {
          String name = rs.getString(1);
          if (name != null && !name.isBlank()) {
            names.add(name);
          }
        }
      }
    }

    return new ArrayList<>(names);
  }

  @Override
  public void collectSchemaObjects(Connection connection, String schemaName, ArrayNode objects)
      throws SQLException {
    DatabaseMetaData metadata = connection.getMetaData();
    String catalog = connection.getCatalog();

    // Dedupe by name: PostgreSQL overloads share a FUNCTION_NAME / PROCEDURE_NAME across
    // signatures, and Explorer currently shows a flat name list (no arg-type disambiguation).
    Set<String> tableNames = new LinkedHashSet<>();
    Set<String> viewNames = new LinkedHashSet<>();
    try (ResultSet tables =
        metadata.getTables(catalog, schemaName, "%", new String[] {"TABLE", "VIEW"})) {
      while (tables.next()) {
        String name = tables.getString("TABLE_NAME");
        String type = tables.getString("TABLE_TYPE");
        if (name == null || name.isBlank()) {
          continue;
        }
        if (type != null && type.toUpperCase(Locale.ROOT).contains("VIEW")) {
          viewNames.add(name);
        } else {
          tableNames.add(name);
        }
      }
    }
    for (String name : tableNames) {
      ObjectNode object = objects.addObject();
      object.put("name", name);
      object.put("kind", "table");
    }
    for (String name : viewNames) {
      ObjectNode object = objects.addObject();
      object.put("name", name);
      object.put("kind", "view");
    }

    Set<String> procedureNames = new LinkedHashSet<>();
    try (ResultSet procedures = metadata.getProcedures(catalog, schemaName, "%")) {
      while (procedures.next()) {
        String name = procedures.getString("PROCEDURE_NAME");
        if (name != null && !name.isBlank()) {
          procedureNames.add(name);
        }
      }
    }
    for (String name : procedureNames) {
      ObjectNode object = objects.addObject();
      object.put("name", name);
      object.put("kind", "procedure");
    }

    Set<String> functionNames = new LinkedHashSet<>();
    try (ResultSet functions = metadata.getFunctions(catalog, schemaName, "%")) {
      while (functions.next()) {
        String name = functions.getString("FUNCTION_NAME");
        if (name != null && !name.isBlank()) {
          functionNames.add(name);
        }
      }
    }
    for (String name : functionNames) {
      ObjectNode object = objects.addObject();
      object.put("name", name);
      object.put("kind", "function");
    }
  }
}
