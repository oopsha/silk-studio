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
    // No PACKAGE or SYNONYM concept on PostgreSQL.
    return List.of(
        MetadataGroupId.TABLES,
        MetadataGroupId.VIEWS,
        MetadataGroupId.PROCEDURES,
        MetadataGroupId.FUNCTIONS,
        MetadataGroupId.INDEXES,
        MetadataGroupId.SEQUENCES,
        MetadataGroupId.TRIGGERS,
        MetadataGroupId.TYPES);
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

    appendSimpleObjects(
        connection,
        "SELECT indexname AS NAME FROM pg_catalog.pg_indexes WHERE schemaname = ?",
        schemaName,
        "index",
        objects);
    appendSimpleObjects(
        connection,
        "SELECT sequence_name AS NAME FROM information_schema.sequences WHERE sequence_schema = ?",
        schemaName,
        "sequence",
        objects);
    appendSimpleObjects(
        connection,
        "SELECT DISTINCT trigger_name AS NAME FROM information_schema.triggers "
            + "WHERE trigger_schema = ?",
        schemaName,
        "trigger",
        objects);
    appendSimpleObjects(
        connection,
        "SELECT t.typname AS NAME FROM pg_catalog.pg_type t "
            + "JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace "
            + "LEFT JOIN pg_catalog.pg_class c ON c.oid = t.typrelid "
            + "WHERE n.nspname = ? AND (t.typrelid = 0 OR c.relkind = 'c') "
            + "AND NOT EXISTS ("
            + "  SELECT 1 FROM pg_catalog.pg_type el WHERE el.oid = t.typelem AND el.typarray = t.oid)",
        schemaName,
        "type",
        objects);
  }

  /** Runs a single-column {@code (NAME) WHERE schema = ?} query and appends {@code kind} objects. */
  private static void appendSimpleObjects(
      Connection connection, String sql, String schemaName, String kind, ArrayNode objects)
      throws SQLException {
    try (PreparedStatement statement = connection.prepareStatement(sql)) {
      statement.setString(1, schemaName);
      try (ResultSet rs = statement.executeQuery()) {
        while (rs.next()) {
          String name = rs.getString("NAME");
          if (name == null || name.isBlank()) {
            continue;
          }
          ObjectNode object = objects.addObject();
          object.put("name", name);
          object.put("kind", kind);
        }
      }
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
  public void collectTableIndexes(
      Connection connection, String schemaName, String tableName, ArrayNode indexes)
      throws SQLException {
    DatabaseMetaData metadata = connection.getMetaData();
    String catalog = connection.getCatalog();
    try (ResultSet rs = metadata.getIndexInfo(catalog, schemaName, tableName, false, true)) {
      MetadataIndexes.appendFromResultSet(rs, indexes);
    }
  }

  @Override
  public void collectTableForeignKeys(
      Connection connection, String schemaName, String tableName, ArrayNode foreignKeys)
      throws SQLException {
    DatabaseMetaData metadata = connection.getMetaData();
    String catalog = connection.getCatalog();
    try (ResultSet rs = metadata.getImportedKeys(catalog, schemaName, tableName)) {
      MetadataForeignKeys.appendFromResultSet(rs, foreignKeys);
    }
  }

  @Override
  public void collectTableConstraints(
      Connection connection, String schemaName, String tableName, ArrayNode constraints)
      throws SQLException {
    String sql =
        "SELECT tc.constraint_name AS NAME, "
            + "CASE tc.constraint_type "
            + "  WHEN 'PRIMARY KEY' THEN 'P' WHEN 'UNIQUE' THEN 'U' ELSE 'C' END AS TYPE, "
            + "kcu.column_name AS COLUMN_NAME, cc.check_clause AS CHECK_CLAUSE, "
            + "COALESCE(kcu.ordinal_position, 0) AS POS "
            + "FROM information_schema.table_constraints tc "
            + "LEFT JOIN information_schema.key_column_usage kcu "
            + "  ON kcu.constraint_name = tc.constraint_name "
            + "  AND kcu.constraint_schema = tc.constraint_schema "
            + "LEFT JOIN information_schema.check_constraints cc "
            + "  ON cc.constraint_name = tc.constraint_name "
            + "  AND cc.constraint_schema = tc.constraint_schema "
            + "WHERE tc.table_schema = ? AND tc.table_name = ? "
            + "  AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE', 'CHECK')";
    try (PreparedStatement statement = connection.prepareStatement(sql)) {
      statement.setString(1, schemaName);
      statement.setString(2, tableName);
      try (ResultSet rs = statement.executeQuery()) {
        MetadataConstraints.appendFromResultSet(rs, constraints);
      }
    }
  }

  @Override
  public void collectTableTriggers(
      Connection connection, String schemaName, String tableName, ArrayNode triggers)
      throws SQLException {
    String sql =
        "SELECT trigger_name AS NAME, action_timing AS TIMING, event_manipulation AS EVENT "
            + "FROM information_schema.triggers "
            + "WHERE event_object_schema = ? AND event_object_table = ?";
    try (PreparedStatement statement = connection.prepareStatement(sql)) {
      statement.setString(1, schemaName);
      statement.setString(2, tableName);
      try (ResultSet rs = statement.executeQuery()) {
        MetadataTriggers.appendFromResultSet(rs, triggers);
      }
    }
  }

  /**
   * PostgreSQL has no routine dependency tracking equivalent to Oracle's ALL_DEPENDENCIES —
   * only view-to-table usage is reliably queryable via {@code information_schema}.
   */
  @Override
  public void collectObjectDependencies(
      Connection connection,
      String schemaName,
      String objectName,
      String kind,
      Boolean packageBody,
      ArrayNode dependencies)
      throws SQLException {
    if (!"view".equals(kind)) {
      return;
    }
    String sql =
        "SELECT table_schema AS SCHEMA, table_name AS NAME, 'TABLE' AS TYPE "
            + "FROM information_schema.view_table_usage "
            + "WHERE view_schema = ? AND view_name = ?";
    try (PreparedStatement statement = connection.prepareStatement(sql)) {
      statement.setString(1, schemaName);
      statement.setString(2, objectName);
      try (ResultSet rs = statement.executeQuery()) {
        MetadataDependencies.appendFromResultSet(rs, dependencies);
      }
    }
  }

  @Override
  public void collectObjectDependents(
      Connection connection,
      String schemaName,
      String objectName,
      String kind,
      Boolean packageBody,
      ArrayNode dependents)
      throws SQLException {
    if (!"table".equals(kind) && !"view".equals(kind)) {
      return;
    }
    String sql =
        "SELECT view_schema AS SCHEMA, view_name AS NAME, 'VIEW' AS TYPE "
            + "FROM information_schema.view_table_usage "
            + "WHERE table_schema = ? AND table_name = ?";
    try (PreparedStatement statement = connection.prepareStatement(sql)) {
      statement.setString(1, schemaName);
      statement.setString(2, objectName);
      try (ResultSet rs = statement.executeQuery()) {
        MetadataDependencies.appendFromResultSet(rs, dependents);
      }
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
