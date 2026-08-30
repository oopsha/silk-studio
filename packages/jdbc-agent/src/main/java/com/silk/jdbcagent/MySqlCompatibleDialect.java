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
import java.util.regex.Matcher;
import java.util.regex.Pattern;

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

  /**
   * Mirrors the frontend's {@code MYSQL_SYSTEM_CATALOGS} ({@code systemNamespaces.ts}) — kept
   * independently since Java can't share that TS module. MySQL/MariaDB has no schema-within-
   * database concept, so this is the only exclusion level needed (unlike SQL Server's separate
   * catalog + schema sets).
   */
  private static final java.util.Set<String> MYSQL_SYSTEM_SCHEMAS =
      java.util.Set.of("information_schema", "mysql", "performance_schema", "sys");

  /**
   * Builds a {@code TABLE_SCHEMA NOT IN (...)} fragment (uppercased binds, since every caller
   * here already compares against {@code UPPER(...)}) excluding MySQL/MariaDB's system
   * databases — empty when {@code includeSystemObjects} is true.
   */
  private static String systemSchemaExclusionSql(boolean includeSystemObjects, String column) {
    if (includeSystemObjects) {
      return "";
    }
    String schemaList =
        MYSQL_SYSTEM_SCHEMAS.stream()
            .map(schema -> "'" + schema.toUpperCase(Locale.ROOT) + "'")
            .collect(java.util.stream.Collectors.joining(", "));
    return "AND UPPER(" + column + ") NOT IN (" + schemaList + ") ";
  }

  @Override
  public void findObjectsByName(
      Connection connection,
      String catalog,
      String name,
      boolean contains,
      java.util.Set<String> kinds,
      boolean includeSystemObjects,
      ArrayNode objects)
      throws SQLException {
    boolean anyKind = kinds == null || kinds.isEmpty();
    // No schema predicate at all — "schema" is the database name for this dialect, and the
    // whole point is finding which database(s) have this table without the caller knowing.
    if (anyKind || kinds.contains("table") || kinds.contains("view")) {
      findTablesAndViewsByName(connection, name, contains, includeSystemObjects, objects);
    }
    // Exact-match mode (AI tool) still widens kind coverage, just without comment matching.
    findOtherKindsByName(
        connection,
        contains ? LikeEscape.containsPattern(name) : name,
        contains,
        anyKind ? null : kinds,
        includeSystemObjects,
        objects);
  }

  /** Table/view portion of {@link #findObjectsByName}, with table/column comment matching. */
  private static void findTablesAndViewsByName(
      Connection connection,
      String name,
      boolean contains,
      boolean includeSystemObjects,
      ArrayNode objects)
      throws SQLException {
    // information_schema.TABLES.TABLE_NAME's collation is server/version dependent (case
    // sensitivity of MySQL identifiers themselves also depends on the OS/lower_case_table_names
    // setting), so we don't rely on the connection's default collation for case-insensitivity —
    // UPPER(...) LIKE UPPER(...) is explicit and correct regardless of collation. Note the
    // doubled backslash: MySQL's own string-literal parser un-escapes `\\` to `\` before the
    // `LIKE ... ESCAPE` clause ever sees it, so the Java source needs two backslashes to produce
    // one literal backslash in the SQL text (unlike the other three dialects, which use one).
    String namePredicate =
        contains ? "UPPER(t.TABLE_NAME) LIKE UPPER(?) ESCAPE '\\\\'" : "t.TABLE_NAME = ?";
    StringBuilder sql =
        new StringBuilder(
            "SELECT t.TABLE_SCHEMA, t.TABLE_NAME, t.TABLE_TYPE, t.TABLE_COMMENT "
                + "FROM information_schema.TABLES t "
                + "WHERE t.TABLE_TYPE IN ('BASE TABLE', 'VIEW') "
                + systemSchemaExclusionSql(includeSystemObjects, "t.TABLE_SCHEMA")
                + "AND ("
                + namePredicate);
    if (contains) {
      sql.append(
          " OR UPPER(t.TABLE_COMMENT) LIKE UPPER(?) ESCAPE '\\\\' "
              + "OR EXISTS (SELECT 1 FROM information_schema.COLUMNS col "
              + "WHERE col.TABLE_SCHEMA = t.TABLE_SCHEMA AND col.TABLE_NAME = t.TABLE_NAME "
              + "AND UPPER(col.COLUMN_COMMENT) LIKE UPPER(?) ESCAPE '\\\\')");
    }
    sql.append(")");

    try (PreparedStatement statement = connection.prepareStatement(sql.toString())) {
      statement.setMaxRows(FIND_OBJECTS_MAX_ROWS);
      statement.setQueryTimeout(FIND_OBJECTS_TIMEOUT_SECONDS);
      String pattern = contains ? LikeEscape.containsPattern(name) : name;
      int index = 1;
      statement.setString(index++, pattern);
      if (contains) {
        statement.setString(index++, pattern);
        statement.setString(index++, pattern);
      }
      try (ResultSet rs = statement.executeQuery()) {
        while (rs.next()) {
          ObjectNode object = objects.addObject();
          object.put("schemaName", rs.getString("TABLE_SCHEMA"));
          object.put("name", rs.getString("TABLE_NAME"));
          String tableType = rs.getString("TABLE_TYPE");
          object.put("kind", "VIEW".equalsIgnoreCase(tableType) ? "view" : "table");
          String tableComment = rs.getString("TABLE_COMMENT");
          if (tableComment != null && !tableComment.isBlank()) {
            object.put("commentSnippet", tableComment);
          }
        }
      }
    }
  }

  /**
   * Procedures/functions/indexes/triggers matching {@code pattern} (no schema predicate — every
   * database on the connection is searched). MySQL/MariaDB has no package/sequence/synonym/type
   * concept, so those kinds are never emitted here.
   */
  private static void findOtherKindsByName(
      Connection connection,
      String pattern,
      boolean useLike,
      java.util.Set<String> kinds,
      boolean includeSystemObjects,
      ArrayNode objects)
      throws SQLException {
    String cmp = useLike ? "LIKE UPPER(?) ESCAPE '\\\\'" : "= ?";
    if (kinds == null || kinds.contains("procedure") || kinds.contains("function")) {
      appendNameFilteredObjects(
          connection,
          "SELECT ROUTINE_SCHEMA AS SCHEMA_NAME, ROUTINE_NAME AS NAME, "
              + "CASE WHEN ROUTINE_TYPE = 'PROCEDURE' THEN 'procedure' ELSE 'function' END AS KIND "
              + "FROM information_schema.ROUTINES WHERE UPPER(ROUTINE_NAME) " + cmp + " "
              + systemSchemaExclusionSql(includeSystemObjects, "ROUTINE_SCHEMA"),
          pattern,
          null,
          kinds,
          objects);
    }
    if (kinds == null || kinds.contains("index")) {
      appendNameFilteredObjects(
          connection,
          "SELECT DISTINCT TABLE_SCHEMA AS SCHEMA_NAME, INDEX_NAME AS NAME "
              + "FROM information_schema.STATISTICS "
              + "WHERE INDEX_NAME IS NOT NULL AND UPPER(INDEX_NAME) " + cmp + " "
              + systemSchemaExclusionSql(includeSystemObjects, "TABLE_SCHEMA"),
          pattern,
          "index",
          kinds,
          objects);
    }
    if (kinds == null || kinds.contains("trigger")) {
      appendNameFilteredObjects(
          connection,
          "SELECT TRIGGER_SCHEMA AS SCHEMA_NAME, TRIGGER_NAME AS NAME "
              + "FROM information_schema.TRIGGERS WHERE UPPER(TRIGGER_NAME) " + cmp + " "
              + systemSchemaExclusionSql(includeSystemObjects, "TRIGGER_SCHEMA"),
          pattern,
          "trigger",
          kinds,
          objects);
    }
  }

  /**
   * Runs a {@code (SCHEMA_NAME, NAME[, KIND])} query filtered by one bound name pattern and
   * appends results — {@code fixedKind} is used verbatim when given, otherwise the row's own
   * {@code KIND} column is read (procedures/functions distinguish kind per row, so {@code kinds}
   * is applied per-row there to honor a filter that selected only one of the two). {@code
   * pattern} is uppercased before binding since every query above compares against {@code
   * UPPER(...)}.
   */
  private static void appendNameFilteredObjects(
      Connection connection,
      String sql,
      String pattern,
      String fixedKind,
      java.util.Set<String> kinds,
      ArrayNode objects)
      throws SQLException {
    try (PreparedStatement statement = connection.prepareStatement(sql)) {
      statement.setMaxRows(FIND_OBJECTS_MAX_ROWS);
      statement.setQueryTimeout(FIND_OBJECTS_TIMEOUT_SECONDS);
      statement.setString(1, pattern.toUpperCase(Locale.ROOT));
      try (ResultSet rs = statement.executeQuery()) {
        while (rs.next()) {
          String name = rs.getString("NAME");
          if (name == null || name.isBlank()) {
            continue;
          }
          String kind = fixedKind != null ? fixedKind : rs.getString("KIND");
          if (kinds != null && !kinds.contains(kind)) {
            continue;
          }
          ObjectNode object = objects.addObject();
          object.put("schemaName", rs.getString("SCHEMA_NAME"));
          object.put("name", name);
          object.put("kind", kind);
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
          case "trigger" -> "SHOW CREATE TRIGGER `" + quoteMySqlIdentifier(schemaName) + "`.`"
              + quoteMySqlIdentifier(objectName) + "`";
          default -> throw new RuntimeException("Unsupported object kind for DDL: " + kind);
        };

    try (Statement statement = connection.createStatement();
        ResultSet rs = statement.executeQuery(sql)) {
      if (!rs.next()) {
        return null;
      }
      String ddl = rs.getString(2);
      if (ddl == null) {
        return null;
      }
      ddl = ddl.trim();
      return "view".equals(kind) ? insertOrReplace(ddl) : ddl;
    }
  }

  private static final Pattern MYSQL_CREATE_HEADER = Pattern.compile("(?i)^\\s*CREATE\\s+");

  /**
   * {@code SHOW CREATE VIEW} never includes {@code OR REPLACE} — it returns the object's current
   * definition, not the statement that (re)created it — so the DDL text shown to the user doesn't
   * match what the frontend's Save path actually executes (it silently rewrites {@code CREATE} to
   * {@code CREATE OR REPLACE} only in the statement it sends to the DB, per buildPlsqlSaveSql.ts).
   * Inserting it here means the displayed/copy-pastable text is directly re-executable against an
   * existing view without that silent rewrite (MySQL/MariaDB have supported {@code CREATE OR
   * REPLACE VIEW} since well before any version this app targets).
   */
  private static String insertOrReplace(String ddl) {
    Matcher matcher = MYSQL_CREATE_HEADER.matcher(ddl);
    if (!matcher.find()) {
      return ddl;
    }
    return matcher.replaceFirst(Matcher.quoteReplacement("CREATE OR REPLACE "));
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
