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
 * Shared behavior for the MySQL-protocol-compatible dialects (MySQL Connector/J, MariaDB
 * Connector/J). Both drivers expose the same {@link DatabaseMetaData} shape — "schema" and
 * "catalog" are the same thing (the database), and neither has a PACKAGE concept — so only
 * {@link DbDialect#id()} and {@link DbDialect#matchesUrl} differ between {@link MySqlDialect}
 * and {@link MariaDbDialect}. They stay separate classes (and separate frontend driver ids /
 * bundled jars) rather than one dialect for two URL prefixes, since they're distinct official
 * drivers with independent versioning and licenses (see THIRD_PARTY_NOTICES.md).
 */
abstract class MySqlCompatibleDialect implements DbDialect {
  @Override
  public void testConnection(Connection connection, int timeoutSeconds) throws SQLException {
    runTestQuery(connection, timeoutSeconds, "SELECT 1");
  }

  @Override
  public void afterConnect(Connection connection, JsonNode params) throws SQLException {
    String catalog = params.path("catalog").asText("").trim();
    if (!catalog.isEmpty()) {
      // Equivalent to `USE catalog`; both drivers treat catalog and "current database" as the
      // same thing, so this alone picks the default namespace for unqualified queries.
      connection.setCatalog(catalog);
    }
  }

  @Override
  public List<MetadataGroupId> supportedGroups() {
    // No PACKAGE concept on MySQL/MariaDB.
    return List.of(
        MetadataGroupId.TABLES,
        MetadataGroupId.VIEWS,
        MetadataGroupId.PROCEDURES,
        MetadataGroupId.FUNCTIONS);
  }

  @Override
  public List<String> listSchemaNames(Connection connection) throws SQLException {
    Set<String> names = new LinkedHashSet<>();
    // Databases are reported via getCatalogs() (TABLE_CAT); getSchemas() is effectively unused.
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
    // `schemaName` here is a database name; pass it as the JDBC catalog and leave the schema
    // pattern null (no separate schema level).
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

    // getFunctions (JDBC 4.0+) reports stored functions separately from getProcedures.
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

    // No PACKAGE concept; nothing to add for the "package" kind.
  }

  @Override
  public void collectTableColumns(
      Connection connection, String schemaName, String tableName, ArrayNode columns)
      throws SQLException {
    // schemaName is the database/catalog name for MySQL-compatible drivers.
    DatabaseMetaData metadata = connection.getMetaData();
    try (ResultSet rs = metadata.getColumns(schemaName, null, tableName, "%")) {
      MetadataColumns.appendFromResultSet(rs, columns);
    }
  }

  @Override
  public String collectPrimaryKeys(
      Connection connection, String schemaName, String tableName, ArrayNode keys)
      throws SQLException {
    List<String> candidates = new ArrayList<>();
    String catalog = connection.getCatalog();
    if (catalog != null && !catalog.isBlank()) {
      candidates.add(catalog.trim());
    }
    candidates.addAll(MetadataTableScope.sessionSchemaCandidates(connection));
    return MetadataTableScope.collectPrimaryKeys(
        connection, schemaName, tableName, keys, candidates, catalog);
  }

  @Override
  public String fetchObjectDdl(
      Connection connection, String schemaName, String objectName, String kind)
      throws SQLException {
    String sql =
        switch (kind) {
          case "table" -> "SHOW CREATE TABLE `" + quoteMySqlIdentifier(schemaName) + "`.`"
              + quoteMySqlIdentifier(objectName) + "`";
          case "view" -> "SHOW CREATE VIEW `" + quoteMySqlIdentifier(schemaName) + "`.`"
              + quoteMySqlIdentifier(objectName) + "`";
          case "procedure" -> "SHOW CREATE PROCEDURE `" + quoteMySqlIdentifier(schemaName) + "`.`"
              + quoteMySqlIdentifier(objectName) + "`";
          case "function" -> "SHOW CREATE FUNCTION `" + quoteMySqlIdentifier(schemaName) + "`.`"
              + quoteMySqlIdentifier(objectName) + "`";
          default -> throw new RuntimeException("Unsupported object kind for DDL: " + kind);
        };

    try (Statement statement = connection.createStatement();
        ResultSet rs = statement.executeQuery(sql)) {
      if (!rs.next()) {
        return null;
      }
      String ddl = rs.getString(2);
      return ddl == null ? null : ddl.trim();
    }
  }

  private static String quoteMySqlIdentifier(String value) {
    return value.replace("`", "``");
  }
}
