package com.silk.jdbcagent;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.PreparedStatement;
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

  @Override
  public void collectTableColumns(
      Connection connection, String schemaName, String tableName, ArrayNode columns)
      throws SQLException {
    DatabaseMetaData metadata = connection.getMetaData();
    String catalog = connection.getCatalog();
    try (ResultSet rs = metadata.getColumns(catalog, schemaName, tableName, "%")) {
      MetadataColumns.appendFromResultSet(rs, columns);
    }
  }

  @Override
  public String collectPrimaryKeys(
      Connection connection, String schemaName, String tableName, ArrayNode keys)
      throws SQLException {
    List<String> candidates = new ArrayList<>();
    String currentSchema =
        MetadataTableScope.querySingleString(connection, "SELECT current_schema()");
    if (currentSchema != null) {
      candidates.add(currentSchema);
    }
    candidates.addAll(MetadataTableScope.sessionSchemaCandidates(connection));
    return MetadataTableScope.collectPrimaryKeys(
        connection, schemaName, tableName, keys, candidates, connection.getCatalog());
  }

  @Override
  public String fetchObjectDdl(
      Connection connection,
      String schemaName,
      String objectName,
      String kind,
      Boolean packageBody)
      throws SQLException {
    return switch (kind) {
      case "table" -> fetchPostgreSqlTableDdl(connection, schemaName, objectName);
      case "view" -> fetchPostgreSqlViewDdl(connection, schemaName, objectName);
      case "function", "procedure" -> fetchPostgreSqlRoutineDdl(connection, schemaName, objectName);
      default -> throw new RuntimeException("Unsupported object kind for DDL: " + kind);
    };
  }

  private String fetchPostgreSqlViewDdl(
      Connection connection, String schemaName, String objectName) throws SQLException {
    String sql =
        "SELECT pg_get_viewdef(c.oid, true) "
            + "FROM pg_catalog.pg_class c "
            + "JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace "
            + "WHERE n.nspname = ? AND c.relname = ? AND c.relkind IN ('v', 'm')";
    try (PreparedStatement statement = connection.prepareStatement(sql)) {
      statement.setString(1, schemaName);
      statement.setString(2, objectName);
      try (ResultSet rs = statement.executeQuery()) {
        return MetadataDdl.readFirstColumnAsString(rs);
      }
    }
  }

  private String fetchPostgreSqlRoutineDdl(
      Connection connection, String schemaName, String objectName) throws SQLException {
    String sql =
        "SELECT pg_get_functiondef(p.oid) "
            + "FROM pg_catalog.pg_proc p "
            + "JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace "
            + "WHERE n.nspname = ? AND p.proname = ? "
            + "ORDER BY p.oid";
    try (PreparedStatement statement = connection.prepareStatement(sql)) {
      statement.setString(1, schemaName);
      statement.setString(2, objectName);
      try (ResultSet rs = statement.executeQuery()) {
        return MetadataDdl.readAllFirstColumns(rs, "\n\n");
      }
    }
  }

  private String fetchPostgreSqlTableDdl(
      Connection connection, String schemaName, String objectName) throws SQLException {
    String sql =
        "SELECT "
            + "'CREATE TABLE ' || quote_ident(n.nspname) || '.' || quote_ident(c.relname) || E' (\\n' || "
            + "pg_catalog.array_to_string(ARRAY("
            + "  SELECT '    ' || quote_ident(a.attname) || ' ' || "
            + "         pg_catalog.format_type(a.atttypid, a.atttypmod) || "
            + "         CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END "
            + "  FROM pg_catalog.pg_attribute a "
            + "  WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped "
            + "  ORDER BY a.attnum"
            + "), E',\\n') || E'\\n);' "
            + "FROM pg_catalog.pg_class c "
            + "JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace "
            + "WHERE n.nspname = ? AND c.relname = ? AND c.relkind IN ('r', 'p')";
    try (PreparedStatement statement = connection.prepareStatement(sql)) {
      statement.setString(1, schemaName);
      statement.setString(2, objectName);
      try (ResultSet rs = statement.executeQuery()) {
        return MetadataDdl.readFirstColumnAsString(rs);
      }
    }
  }
}
