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
 * Microsoft SQL Server (mssql-jdbc) dialect. Scope: SQL authentication only — Windows Integrated
 * Auth / Entra ID are left for a later iteration (see multi-jdbc-rollout plan).
 */
final class SqlServerDialect implements DbDialect {
  @Override
  public String id() {
    return "sqlserver";
  }

  @Override
  public boolean matchesUrl(String normalizedUrl) {
    return normalizedUrl.startsWith("jdbc:sqlserver:");
  }

  @Override
  public void testConnection(Connection connection, int timeoutSeconds) throws SQLException {
    runTestQuery(connection, timeoutSeconds, "SELECT 1");
  }

  @Override
  public void afterConnect(Connection connection, JsonNode params) throws SQLException {
    String catalog = params.path("catalog").asText("").trim();
    if (!catalog.isEmpty()) {
      // Equivalent to `USE [catalog]`; scopes getTables/getSchemas and unqualified queries.
      connection.setCatalog(catalog);
    }
    // SQL Server has no session-scoped equivalent of Oracle's `ALTER SESSION SET
    // CURRENT_SCHEMA`; the requested default schema is applied as an Explorer/UI hint only
    // (see ConnectionsExplorer's default-schema highlighting) rather than a server-side setting.
  }

  @Override
  public List<MetadataGroupId> supportedGroups() {
    // No PACKAGE concept on SQL Server.
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
          ResultSet rs = statement.executeQuery("SELECT SCHEMA_NAME()")) {
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

    try (ResultSet tables =
        metadata.getTables(catalog, schemaName, "%", new String[] {"TABLE", "VIEW"})) {
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

    try (ResultSet procedures = metadata.getProcedures(catalog, schemaName, "%")) {
      while (procedures.next()) {
        String name = stripProcedureNumberSuffix(procedures.getString("PROCEDURE_NAME"));
        if (name == null || name.isBlank()) {
          continue;
        }
        ObjectNode object = objects.addObject();
        object.put("name", name);
        object.put("kind", "procedure");
      }
    }

    // getFunctions (JDBC 4.0+) reports scalar/table-valued functions separately from
    // getProcedures, so no extra filtering is needed to tell them apart on SQL Server.
    try (ResultSet functions = metadata.getFunctions(catalog, schemaName, "%")) {
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

    // SQL Server has no PACKAGE concept; nothing to add for the "package" kind.
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
        MetadataTableScope.querySingleString(connection, "SELECT SCHEMA_NAME()");
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
    if ("table".equals(kind)) {
      return fetchSqlServerTableDdl(connection, schemaName, objectName);
    }

    String objectType =
        switch (kind) {
          case "view" -> "V";
          case "procedure" -> "P";
          case "function" -> "FN";
          default -> throw new RuntimeException("Unsupported object kind for DDL: " + kind);
        };

    String sql =
        "SELECT m.definition "
            + "FROM sys.sql_modules m "
            + "INNER JOIN sys.objects o ON m.object_id = o.object_id "
            + "INNER JOIN sys.schemas s ON o.schema_id = s.schema_id "
            + "WHERE s.name = ? AND o.name = ? AND o.type = ?";
    try (PreparedStatement statement = connection.prepareStatement(sql)) {
      statement.setString(1, schemaName);
      statement.setString(2, objectName);
      statement.setString(3, objectType);
      try (ResultSet rs = statement.executeQuery()) {
        return MetadataDdl.readFirstColumnAsString(rs);
      }
    }
  }

  private String fetchSqlServerTableDdl(
      Connection connection, String schemaName, String objectName) throws SQLException {
    String sql =
        "SELECT "
            + "'CREATE TABLE ' + QUOTENAME(?) + '.' + QUOTENAME(?) + ' (' + CHAR(13) + CHAR(10) + "
            + "STUFF(("
            + "  SELECT CHAR(13) + CHAR(10) + '    , ' + QUOTENAME(c.COLUMN_NAME) + ' ' + "
            + "         c.DATA_TYPE + "
            + "         CASE "
            + "           WHEN c.CHARACTER_MAXIMUM_LENGTH IS NOT NULL "
            + "             THEN '(' + CASE WHEN c.CHARACTER_MAXIMUM_LENGTH = -1 THEN 'max' "
            + "               ELSE CAST(c.CHARACTER_MAXIMUM_LENGTH AS varchar(20)) END + ')' "
            + "           WHEN c.NUMERIC_PRECISION IS NOT NULL "
            + "             THEN '(' + CAST(c.NUMERIC_PRECISION AS varchar(20)) + "
            + "               CASE WHEN c.NUMERIC_SCALE IS NOT NULL AND c.NUMERIC_SCALE > 0 "
            + "                 THEN ',' + CAST(c.NUMERIC_SCALE AS varchar(20)) ELSE '' END + ')' "
            + "           ELSE '' "
            + "         END + "
            + "         CASE WHEN c.IS_NULLABLE = 'NO' THEN ' NOT NULL' ELSE '' END "
            + "  FROM INFORMATION_SCHEMA.COLUMNS c "
            + "  WHERE c.TABLE_SCHEMA = ? AND c.TABLE_NAME = ? "
            + "  ORDER BY c.ORDINAL_POSITION "
            + "  FOR XML PATH(''), TYPE).value('.', 'nvarchar(max)'), 1, 7, '    ') + "
            + "CHAR(13) + CHAR(10) + ');'";

    try (PreparedStatement statement = connection.prepareStatement(sql)) {
      statement.setString(1, schemaName);
      statement.setString(2, objectName);
      statement.setString(3, schemaName);
      statement.setString(4, objectName);
      try (ResultSet rs = statement.executeQuery()) {
        return MetadataDdl.readFirstColumnAsString(rs);
      }
    }
  }

  /**
   * mssql-jdbc's {@code getProcedures} suffixes names with a numbered-procedure marker
   * (e.g. {@code "MyProc;1"}); strip it so the Explorer shows the plain object name.
   */
  private static String stripProcedureNumberSuffix(String name) {
    if (name == null) {
      return null;
    }
    int index = name.lastIndexOf(';');
    return index >= 0 ? name.substring(0, index) : name;
  }
}
