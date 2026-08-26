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
 * Shared behavior for the MySQL-protocol-compatible dialects (MySQL Connector/J, MariaDB
 * Connector/J). Both drivers expose the same {@link DatabaseMetaData} shape — "schema" and
 * "catalog" are the same thing (the database), and neither has a PACKAGE concept — so only
 * {@link DbDialect#id()} and {@link DbDialect#matchesUrl} differ between {@link MySqlDialect}
 * and {@link MariaDbDialect}. They stay separate classes (and separate frontend driver ids /
 * bundled jars) rather than one dialect for two URL prefixes, since they're distinct official
 * drivers with independent versioning and licenses (see THIRD_PARTY_NOTICES.md).
 *
 * <p>The {@code catalog} parameter threaded through {@link DbDialect} is mostly a no-op here:
 * every method already receives the target database as {@code schemaName} (there's no separate
 * schema level), and every query below is already explicitly scoped by that value rather than
 * the connection's current catalog — so browsing another database never requires {@code
 * connection.setCatalog()}. The one place the connection's *current* catalog leaked in was
 * {@link #collectPrimaryKeys}'s schema-candidate fallback, fixed below to prefer the passed
 * {@code catalog} when present.
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
    // No PACKAGE/SEQUENCE/SYNONYM/user-defined TYPE concept on MySQL/MariaDB.
    return List.of(
        MetadataGroupId.TABLES,
        MetadataGroupId.VIEWS,
        MetadataGroupId.PROCEDURES,
        MetadataGroupId.FUNCTIONS,
        MetadataGroupId.INDEXES,
        MetadataGroupId.TRIGGERS);
  }

  @Override
  public List<String> listSchemaNames(Connection connection, String catalog) throws SQLException {
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
  public void collectSchemaObjects(
      Connection connection,
      String catalog,
      String schemaName,
      boolean includeSecondaryKinds,
      ArrayNode objects)
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

    if (!includeSecondaryKinds) {
      return;
    }

    appendSimpleObjects(
        connection,
        "SELECT DISTINCT INDEX_NAME AS NAME FROM information_schema.STATISTICS "
            + "WHERE TABLE_SCHEMA = ? AND INDEX_NAME IS NOT NULL",
        schemaName,
        "index",
        objects);
    appendSimpleObjects(
        connection,
        "SELECT TRIGGER_NAME AS NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ?",
        schemaName,
        "trigger",
        objects);
  }

  @Override
  public void findObjectsByName(
      Connection connection, String catalog, String name, boolean contains, ArrayNode objects)
      throws SQLException {
    // No schema predicate at all — "schema" is the database name for this dialect, and the
    // whole point is finding which database(s) have this table without the caller knowing.
    //
    // information_schema.TABLES.TABLE_NAME's collation is server/version dependent (case
    // sensitivity of MySQL identifiers themselves also depends on the OS/lower_case_table_names
    // setting), so we don't rely on the connection's default collation for case-insensitivity —
    // UPPER(...) LIKE UPPER(...) is explicit and correct regardless of collation.
    String predicate =
        contains ? "UPPER(TABLE_NAME) LIKE UPPER(?) ESCAPE '\\\\'" : "TABLE_NAME = ?";
    String sql =
        "SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES "
            + "WHERE " + predicate + " AND TABLE_TYPE IN ('BASE TABLE', 'VIEW')";
    try (PreparedStatement statement = connection.prepareStatement(sql)) {
      statement.setString(1, contains ? LikeEscape.containsPattern(name) : name);
      try (ResultSet rs = statement.executeQuery()) {
        while (rs.next()) {
          ObjectNode object = objects.addObject();
          object.put("schemaName", rs.getString("TABLE_SCHEMA"));
          object.put("name", rs.getString("TABLE_NAME"));
          String tableType = rs.getString("TABLE_TYPE");
          object.put("kind", "VIEW".equalsIgnoreCase(tableType) ? "view" : "table");
        }
      }
    }
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
      Connection connection,
      String catalog,
      String schemaName,
      String tableName,
      ArrayNode columns)
      throws SQLException {
    // schemaName is the database/catalog name for MySQL-compatible drivers.
    DatabaseMetaData metadata = connection.getMetaData();
    try (ResultSet rs = metadata.getColumns(schemaName, null, tableName, "%")) {
      MetadataColumns.appendFromResultSet(rs, columns);
    }
    applyFullTypeNames(connection, schemaName, tableName, columns);
  }

  /**
   * {@code typeName}/{@code columnSize}/{@code decimalDigits} alone can't losslessly reproduce
   * MySQL/MariaDB's full column-type text for {@code ENUM(...)}/{@code SET(...)} or unsigned/
   * zerofill modifiers. The table-structure editor's rename path (which must restate the entire
   * column definition via {@code CHANGE}) needs the driver's own text verbatim, so fetch
   * {@code COLUMN_TYPE} from {@code information_schema.COLUMNS} and merge it in.
   */
  private static void applyFullTypeNames(
      Connection connection, String schemaName, String tableName, ArrayNode columns)
      throws SQLException {
    if (columns.isEmpty()) {
      return;
    }
    String sql =
        "SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS "
            + "WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?";
    try (PreparedStatement statement = connection.prepareStatement(sql)) {
      statement.setString(1, schemaName);
      statement.setString(2, tableName);
      try (ResultSet rs = statement.executeQuery()) {
        while (rs.next()) {
          String columnName = rs.getString("COLUMN_NAME");
          String fullTypeName = rs.getString("COLUMN_TYPE");
          if (columnName == null || fullTypeName == null || fullTypeName.isBlank()) {
            continue;
          }
          for (JsonNode node : columns) {
            if (node instanceof ObjectNode objectNode
                && columnName.equals(objectNode.path("name").asText(null))) {
              objectNode.put("fullTypeName", fullTypeName);
              break;
            }
          }
        }
      }
    }
  }

  @Override
  public void collectRoutineArguments(
      Connection connection,
      String catalog,
      String schemaName,
      String routineName,
      String kind,
      ArrayNode arguments)
      throws SQLException {
    // schemaName is the database/catalog name for MySQL-compatible drivers.
    DatabaseMetaData metadata = connection.getMetaData();
    boolean isFunction = "function".equals(kind);
    try (ResultSet rs =
        isFunction
            ? metadata.getFunctionColumns(schemaName, null, routineName, "%")
            : metadata.getProcedureColumns(schemaName, null, routineName, "%")) {
      MetadataArguments.appendFromResultSet(rs, kind, arguments);
    }
  }

  @Override
  public String fetchTableComment(
      Connection connection, String catalog, String schemaName, String tableName)
      throws SQLException {
    // MySQL/MariaDB have no separate comment concept for views (TABLE_COMMENT is typically
    // "VIEW" there, not a user comment) — this still returns whatever's actually stored.
    String sql =
        "SELECT TABLE_COMMENT AS COMMENT FROM information_schema.TABLES "
            + "WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?";
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

  @Override
  public void collectTableIndexes(
      Connection connection,
      String catalog,
      String schemaName,
      String tableName,
      ArrayNode indexes)
      throws SQLException {
    DatabaseMetaData metadata = connection.getMetaData();
    try (ResultSet rs = metadata.getIndexInfo(schemaName, null, tableName, false, true)) {
      MetadataIndexes.appendFromResultSet(rs, indexes);
    }
  }

  @Override
  public void collectTableForeignKeys(
      Connection connection,
      String catalog,
      String schemaName,
      String tableName,
      ArrayNode foreignKeys)
      throws SQLException {
    DatabaseMetaData metadata = connection.getMetaData();
    try (ResultSet rs = metadata.getImportedKeys(schemaName, null, tableName)) {
      MetadataForeignKeys.appendFromResultSet(rs, foreignKeys);
    }
  }

  @Override
  public void collectTableReferences(
      Connection connection,
      String catalog,
      String schemaName,
      String tableName,
      ArrayNode references)
      throws SQLException {
    DatabaseMetaData metadata = connection.getMetaData();
    try (ResultSet rs = metadata.getExportedKeys(schemaName, null, tableName)) {
      MetadataReferences.appendFromResultSet(rs, references);
    }
  }

  @Override
  public void collectTableConstraints(
      Connection connection,
      String catalog,
      String schemaName,
      String tableName,
      ArrayNode constraints)
      throws SQLException {
    String keySql =
        "SELECT tc.CONSTRAINT_NAME AS NAME, "
            + "CASE tc.CONSTRAINT_TYPE WHEN 'PRIMARY KEY' THEN 'P' WHEN 'UNIQUE' THEN 'U' "
            + "  ELSE 'C' END AS TYPE, "
            + "kcu.COLUMN_NAME AS COLUMN_NAME, NULL AS CHECK_CLAUSE, kcu.ORDINAL_POSITION AS POS "
            + "FROM information_schema.TABLE_CONSTRAINTS tc "
            + "JOIN information_schema.KEY_COLUMN_USAGE kcu "
            + "  ON kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME "
            + "  AND kcu.TABLE_SCHEMA = tc.TABLE_SCHEMA AND kcu.TABLE_NAME = tc.TABLE_NAME "
            + "WHERE tc.TABLE_SCHEMA = ? AND tc.TABLE_NAME = ? "
            + "  AND tc.CONSTRAINT_TYPE IN ('PRIMARY KEY', 'UNIQUE')";
    try (PreparedStatement statement = connection.prepareStatement(keySql)) {
      statement.setString(1, schemaName);
      statement.setString(2, tableName);
      try (ResultSet rs = statement.executeQuery()) {
        MetadataConstraints.appendFromResultSet(rs, constraints);
      }
    }

    // CHECK_CONSTRAINTS only exists on MySQL 8.0.16+ / MariaDB 10.2+ — older servers 404 here.
    String checkSql =
        "SELECT cc.CONSTRAINT_NAME AS NAME, 'C' AS TYPE, NULL AS COLUMN_NAME, "
            + "cc.CHECK_CLAUSE AS CHECK_CLAUSE, 0 AS POS "
            + "FROM information_schema.CHECK_CONSTRAINTS cc "
            + "JOIN information_schema.TABLE_CONSTRAINTS tc "
            + "  ON tc.CONSTRAINT_NAME = cc.CONSTRAINT_NAME "
            + "  AND tc.CONSTRAINT_SCHEMA = cc.CONSTRAINT_SCHEMA "
            + "WHERE cc.CONSTRAINT_SCHEMA = ? AND tc.TABLE_NAME = ?";
    try (PreparedStatement statement = connection.prepareStatement(checkSql)) {
      statement.setString(1, schemaName);
      statement.setString(2, tableName);
      try (ResultSet rs = statement.executeQuery()) {
        MetadataConstraints.appendFromResultSet(rs, constraints);
      }
    } catch (SQLException ignored) {
      // Server too old for CHECK_CONSTRAINTS — PK/unique constraints above still apply.
    }
  }

  @Override
  public void collectTableTriggers(
      Connection connection,
      String catalog,
      String schemaName,
      String tableName,
      ArrayNode triggers)
      throws SQLException {
    String sql =
        "SELECT TRIGGER_NAME AS NAME, ACTION_TIMING AS TIMING, EVENT_MANIPULATION AS EVENT "
            + "FROM information_schema.TRIGGERS "
            + "WHERE TRIGGER_SCHEMA = ? AND EVENT_OBJECT_TABLE = ?";
    try (PreparedStatement statement = connection.prepareStatement(sql)) {
      statement.setString(1, schemaName);
      statement.setString(2, tableName);
      try (ResultSet rs = statement.executeQuery()) {
        MetadataTriggers.appendFromResultSet(rs, triggers);
      }
    }
  }

  /**
   * MySQL/MariaDB have no routine dependency tracking — only view-to-table usage is reliably
   * queryable via {@code information_schema}.
   */
  @Override
  public void collectObjectDependencies(
      Connection connection,
      String catalog,
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
        "SELECT TABLE_SCHEMA AS SCHEMA, TABLE_NAME AS NAME, 'TABLE' AS TYPE "
            + "FROM information_schema.VIEW_TABLE_USAGE "
            + "WHERE VIEW_SCHEMA = ? AND VIEW_NAME = ?";
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
      String catalog,
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
        "SELECT VIEW_SCHEMA AS SCHEMA, VIEW_NAME AS NAME, 'VIEW' AS TYPE "
            + "FROM information_schema.VIEW_TABLE_USAGE "
            + "WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?";
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
      Connection connection,
      String catalog,
      String schemaName,
      String tableName,
      ArrayNode keys)
      throws SQLException {
    List<String> candidates = new ArrayList<>();
    String effectiveCatalog =
        catalog != null && !catalog.isBlank() ? catalog.trim() : connection.getCatalog();
    if (effectiveCatalog != null && !effectiveCatalog.isBlank()) {
      candidates.add(effectiveCatalog);
    }
    candidates.addAll(MetadataTableScope.sessionSchemaCandidates(connection));
    return MetadataTableScope.collectPrimaryKeys(
        connection, schemaName, tableName, keys, candidates, effectiveCatalog);
  }

  @Override
  public String fetchObjectDdl(
      Connection connection,
      String catalog,
      String schemaName,
      String objectName,
      String kind,
      Boolean packageBody)
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

  @Override
  public String quoteIdentifier(String raw) {
    return "`" + quoteMySqlIdentifier(raw) + "`";
  }

  /** LIMIT/OFFSET — no ORDER BY requirement, so it's simply omitted when absent. */
  @Override
  public String wrapPagedQuery(
      String innerSql, String whereFragment, String orderByFragment, int offset, int limit) {
    StringBuilder sql = new StringBuilder("SELECT * FROM (").append(innerSql).append(") sq");
    if (whereFragment != null && !whereFragment.isBlank()) {
      sql.append(" WHERE ").append(whereFragment);
    }
    if (orderByFragment != null && !orderByFragment.isBlank()) {
      sql.append(" ORDER BY ").append(orderByFragment);
    }
    sql.append(" LIMIT ").append(limit).append(" OFFSET ").append(offset);
    return sql.toString();
  }
}
