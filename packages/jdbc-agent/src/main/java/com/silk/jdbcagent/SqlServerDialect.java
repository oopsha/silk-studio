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
        MetadataGroupId.FUNCTIONS,
        MetadataGroupId.INDEXES,
        MetadataGroupId.SEQUENCES,
        MetadataGroupId.SYNONYMS,
        MetadataGroupId.TRIGGERS,
        MetadataGroupId.TYPES);
  }

  @Override
  public boolean usesCatalogExplorer() {
    return true;
  }

  @Override
  public List<String> listCatalogNames(Connection connection) throws SQLException {
    Set<String> names = new LinkedHashSet<>();
    try (ResultSet catalogs = connection.getMetaData().getCatalogs()) {
      while (catalogs.next()) {
        String name = catalogs.getString("TABLE_CAT");
        if (name != null && !name.isBlank()) {
          names.add(name);
        }
      }
    }
    if (names.isEmpty()) {
      String current = connection.getCatalog();
      if (current != null && !current.isBlank()) {
        names.add(current);
      }
    }
    return new ArrayList<>(names);
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

    appendSimpleObjects(
        connection,
        "SELECT DISTINCT i.name AS NAME FROM sys.indexes i "
            + "JOIN sys.objects o ON o.object_id = i.object_id "
            + "JOIN sys.schemas s ON s.schema_id = o.schema_id "
            + "WHERE s.name = ? AND i.name IS NOT NULL AND o.is_ms_shipped = 0",
        schemaName,
        "index",
        objects);
    appendSimpleObjects(
        connection,
        "SELECT sq.name AS NAME FROM sys.sequences sq "
            + "JOIN sys.schemas s ON s.schema_id = sq.schema_id "
            + "WHERE s.name = ?",
        schemaName,
        "sequence",
        objects);
    appendSimpleObjects(
        connection,
        "SELECT syn.name AS NAME FROM sys.synonyms syn "
            + "JOIN sys.schemas s ON s.schema_id = syn.schema_id "
            + "WHERE s.name = ?",
        schemaName,
        "synonym",
        objects);
    appendSimpleObjects(
        connection,
        "SELECT tr.name AS NAME FROM sys.triggers tr "
            + "JOIN sys.objects o ON o.object_id = tr.parent_id "
            + "JOIN sys.schemas s ON s.schema_id = o.schema_id "
            + "WHERE s.name = ? AND tr.parent_class = 1",
        schemaName,
        "trigger",
        objects);
    appendSimpleObjects(
        connection,
        "SELECT t.name AS NAME FROM sys.types t "
            + "JOIN sys.schemas s ON s.schema_id = t.schema_id "
            + "WHERE s.name = ? AND t.is_user_defined = 1",
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
    applyColumnComments(connection, schemaName, tableName, columns);
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
  public void collectTableReferences(
      Connection connection, String schemaName, String tableName, ArrayNode references)
      throws SQLException {
    DatabaseMetaData metadata = connection.getMetaData();
    String catalog = connection.getCatalog();
    try (ResultSet rs = metadata.getExportedKeys(catalog, schemaName, tableName)) {
      MetadataReferences.appendFromResultSet(rs, references);
    }
  }

  @Override
  public void collectTableConstraints(
      Connection connection, String schemaName, String tableName, ArrayNode constraints)
      throws SQLException {
    String sql =
        "SELECT k.name AS NAME, CASE WHEN k.type = 'PK' THEN 'P' ELSE 'U' END AS TYPE, "
            + "c.name AS COLUMN_NAME, NULL AS CHECK_CLAUSE, ic.key_ordinal AS POS "
            + "FROM sys.key_constraints k "
            + "JOIN sys.tables t ON t.object_id = k.parent_object_id "
            + "JOIN sys.schemas s ON s.schema_id = t.schema_id "
            + "JOIN sys.index_columns ic "
            + "  ON ic.object_id = k.parent_object_id AND ic.index_id = k.unique_index_id "
            + "JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id "
            + "WHERE s.name = ? AND t.name = ? "
            + "UNION ALL "
            + "SELECT cc.name, 'C', NULL, cc.definition, 0 "
            + "FROM sys.check_constraints cc "
            + "JOIN sys.tables t ON t.object_id = cc.parent_object_id "
            + "JOIN sys.schemas s ON s.schema_id = t.schema_id "
            + "WHERE s.name = ? AND t.name = ?";
    try (PreparedStatement statement = connection.prepareStatement(sql)) {
      statement.setString(1, schemaName);
      statement.setString(2, tableName);
      statement.setString(3, schemaName);
      statement.setString(4, tableName);
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
        "SELECT tr.name AS NAME, te.type_desc AS EVENT, "
            + "CASE WHEN tr.is_instead_of_trigger = 1 THEN 'INSTEAD OF' ELSE 'AFTER' END AS TIMING, "
            + "CAST(CASE WHEN tr.is_disabled = 1 THEN 0 ELSE 1 END AS BIT) AS ENABLED "
            + "FROM sys.triggers tr "
            + "JOIN sys.objects o ON o.object_id = tr.parent_id "
            + "JOIN sys.schemas s ON s.schema_id = o.schema_id "
            + "LEFT JOIN sys.trigger_events te ON te.object_id = tr.object_id "
            + "WHERE s.name = ? AND o.name = ? AND tr.parent_class = 1";
    try (PreparedStatement statement = connection.prepareStatement(sql)) {
      statement.setString(1, schemaName);
      statement.setString(2, tableName);
      try (ResultSet rs = statement.executeQuery()) {
        MetadataTriggers.appendFromResultSet(rs, triggers);
      }
    }
  }

  /**
   * {@code sys.sql_expression_dependencies} only covers modules with a definition
   * (views/procedures/functions/triggers) — plain tables have essentially no outgoing
   * dependencies here, which is expected (their only cross-object references are FK constraints,
   * already covered by the Foreign Keys section).
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
    String sql =
        "SELECT DISTINCT rs.name AS [SCHEMA], ro.name AS NAME, ro.type_desc AS TYPE "
            + "FROM sys.sql_expression_dependencies d "
            + "JOIN sys.objects o ON o.object_id = d.referencing_id "
            + "JOIN sys.schemas s ON s.schema_id = o.schema_id "
            + "JOIN sys.objects ro ON ro.object_id = d.referenced_id "
            + "JOIN sys.schemas rs ON rs.schema_id = ro.schema_id "
            + "WHERE s.name = ? AND o.name = ?";
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
    String sql =
        "SELECT DISTINCT s2.name AS [SCHEMA], o2.name AS NAME, o2.type_desc AS TYPE "
            + "FROM sys.sql_expression_dependencies d "
            + "JOIN sys.objects o2 ON o2.object_id = d.referencing_id "
            + "JOIN sys.schemas s2 ON s2.schema_id = o2.schema_id "
            + "JOIN sys.objects ot ON ot.object_id = d.referenced_id "
            + "JOIN sys.schemas st ON st.schema_id = ot.schema_id "
            + "WHERE st.name = ? AND ot.name = ?";
    try (PreparedStatement statement = connection.prepareStatement(sql)) {
      statement.setString(1, schemaName);
      statement.setString(2, objectName);
      try (ResultSet rs = statement.executeQuery()) {
        MetadataDependencies.appendFromResultSet(rs, dependents);
      }
    }
  }

  @Override
  public String fetchTableComment(Connection connection, String schemaName, String tableName)
      throws SQLException {
    // Same MS_Description extended-property mechanism as applyColumnComments below, but
    // minor_id = 0 selects the property on the object itself rather than one of its columns.
    // Joins sys.objects (not sys.tables) so this covers views too.
    String sql =
        "SELECT CAST(ep.value AS NVARCHAR(MAX)) AS COMMENT "
            + "FROM sys.objects o "
            + "JOIN sys.schemas s ON s.schema_id = o.schema_id "
            + "LEFT JOIN sys.extended_properties ep "
            + "  ON ep.major_id = o.object_id AND ep.minor_id = 0 AND ep.name = 'MS_Description' "
            + "WHERE s.name = ? AND o.name = ?";
    try (PreparedStatement statement = connection.prepareStatement(sql)) {
      statement.setString(1, schemaName);
      statement.setString(2, tableName);
      try (ResultSet rs = statement.executeQuery()) {
        if (rs.next()) {
          String comment = rs.getString("COMMENT");
          return (comment == null || comment.isBlank()) ? null : comment;
        }
      }
    }
    return null;
  }

  /**
   * mssql-jdbc's {@code getColumns()} never populates REMARKS — SQL Server has no built-in
   * column comment, only an optional {@code MS_Description} extended property — so fetch and
   * merge those in separately. Joins against {@code sys.objects} (not {@code sys.tables}) so
   * this covers view columns too.
   */
  private void applyColumnComments(
      Connection connection, String schemaName, String tableName, ArrayNode columns)
      throws SQLException {
    if (columns.isEmpty()) {
      return;
    }

    String sql =
        "SELECT c.name AS COLUMN_NAME, CAST(ep.value AS NVARCHAR(MAX)) AS REMARKS "
            + "FROM sys.columns c "
            + "JOIN sys.objects o ON o.object_id = c.object_id "
            + "JOIN sys.schemas s ON s.schema_id = o.schema_id "
            + "JOIN sys.extended_properties ep "
            + "  ON ep.major_id = c.object_id AND ep.minor_id = c.column_id AND ep.name = 'MS_Description' "
            + "WHERE s.name = ? AND o.name = ?";

    try (PreparedStatement statement = connection.prepareStatement(sql)) {
      statement.setString(1, schemaName);
      statement.setString(2, tableName);
      try (ResultSet rs = statement.executeQuery()) {
        while (rs.next()) {
          String columnName = rs.getString("COLUMN_NAME");
          String remarks = rs.getString("REMARKS");
          if (columnName == null || remarks == null || remarks.isBlank()) {
            continue;
          }
          for (JsonNode node : columns) {
            if (node instanceof ObjectNode objectNode
                && columnName.equals(objectNode.path("name").asText(null))) {
              objectNode.put("comment", remarks);
              break;
            }
          }
        }
      }
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
