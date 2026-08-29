package com.silk.jdbcagent;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
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
  public List<String> listSchemaNames(Connection connection, String requestedCatalog)
      throws SQLException {
    // pgJDBC selects the database via the connect-time URL; `requestedCatalog` is intentionally
    // unused since there's no way to switch or scope to another database post-connect.
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
  public void collectSchemaObjects(
      Connection connection,
      String requestedCatalog,
      String schemaName,
      boolean includeSecondaryKinds,
      ArrayNode objects)
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

    if (!includeSecondaryKinds) {
      return;
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

  @Override
  public void findObjectsByName(
      Connection connection, String catalog, String name, boolean contains, ArrayNode objects)
      throws SQLException {
    // ILIKE is Postgres's native case-insensitive LIKE — preferred over UPPER(...) LIKE
    // UPPER(...) here since it's available and idiomatic for this dialect.
    findTablesAndViewsByName(connection, name, contains, objects);
    // Exact-match mode (AI tool) still widens kind coverage, just without comment matching.
    findOtherKindsByName(
        connection, contains ? LikeEscape.containsPattern(name) : name, contains, objects);
  }

  /** Table/view portion of {@link #findObjectsByName}, with table/column comment matching. */
  private static void findTablesAndViewsByName(
      Connection connection, String name, boolean contains, ArrayNode objects)
      throws SQLException {
    String namePredicate = contains ? "c.relname ILIKE ? ESCAPE '\\'" : "c.relname = ?";
    StringBuilder sql =
        new StringBuilder(
            "SELECT n.nspname AS SCHEMA_NAME, c.relname AS OBJECT_NAME, c.relkind AS REL_KIND, "
                + "d.description AS TABLE_COMMENT "
                + "FROM pg_catalog.pg_class c "
                + "JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace "
                + "LEFT JOIN pg_catalog.pg_description d ON d.objoid = c.oid AND d.objsubid = 0 "
                + "WHERE c.relkind IN ('r', 'p', 'v', 'm') AND ("
                + namePredicate);
    if (contains) {
      // objsubid = 0 is the relation's own comment; objsubid > 0 is one of its columns'.
      sql.append(
          " OR d.description ILIKE ? ESCAPE '\\' "
              + "OR EXISTS (SELECT 1 FROM pg_catalog.pg_description cd "
              + "WHERE cd.objoid = c.oid AND cd.objsubid > 0 AND cd.description ILIKE ? ESCAPE '\\')");
    }
    sql.append(")");

    try (PreparedStatement statement = connection.prepareStatement(sql.toString())) {
      statement.setMaxRows(FIND_OBJECTS_MAX_ROWS);
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
          object.put("schemaName", rs.getString("SCHEMA_NAME"));
          object.put("name", rs.getString("OBJECT_NAME"));
          String relKind = rs.getString("REL_KIND");
          object.put("kind", "v".equals(relKind) || "m".equals(relKind) ? "view" : "table");
          String tableComment = rs.getString("TABLE_COMMENT");
          if (tableComment != null && !tableComment.isBlank()) {
            object.put("commentSnippet", tableComment);
          }
        }
      }
    }
  }

  /**
   * Procedures/functions/indexes/sequences/triggers/types matching {@code pattern} (no schema
   * predicate — searches every schema on the connection, same as the table/view portion).
   * PostgreSQL has no package/synonym concept, so those two kinds are never emitted here.
   */
  private static void findOtherKindsByName(
      Connection connection, String pattern, boolean useLike, ArrayNode objects)
      throws SQLException {
    String cmp = useLike ? "ILIKE ? ESCAPE '\\'" : "= ?";
    appendNameFilteredObjects(
        connection,
        "SELECT n.nspname AS SCHEMA_NAME, p.proname AS NAME, "
            + "CASE WHEN p.prokind = 'p' THEN 'procedure' ELSE 'function' END AS KIND "
            + "FROM pg_catalog.pg_proc p "
            + "JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace "
            + "WHERE p.proname " + cmp + " "
            + "AND n.nspname NOT IN ('pg_catalog', 'information_schema')",
        pattern,
        null,
        objects);
    appendNameFilteredObjects(
        connection,
        "SELECT schemaname AS SCHEMA_NAME, indexname AS NAME FROM pg_catalog.pg_indexes "
            + "WHERE indexname " + cmp,
        pattern,
        "index",
        objects);
    appendNameFilteredObjects(
        connection,
        "SELECT sequence_schema AS SCHEMA_NAME, sequence_name AS NAME "
            + "FROM information_schema.sequences WHERE sequence_name " + cmp,
        pattern,
        "sequence",
        objects);
    appendNameFilteredObjects(
        connection,
        "SELECT DISTINCT trigger_schema AS SCHEMA_NAME, trigger_name AS NAME "
            + "FROM information_schema.triggers WHERE trigger_name " + cmp,
        pattern,
        "trigger",
        objects);
    appendNameFilteredObjects(
        connection,
        "SELECT n.nspname AS SCHEMA_NAME, t.typname AS NAME FROM pg_catalog.pg_type t "
            + "JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace "
            + "LEFT JOIN pg_catalog.pg_class c ON c.oid = t.typrelid "
            + "WHERE t.typname " + cmp + " "
            + "AND (t.typrelid = 0 OR c.relkind = 'c') "
            + "AND NOT EXISTS ("
            + "  SELECT 1 FROM pg_catalog.pg_type el WHERE el.oid = t.typelem AND el.typarray = t.oid)",
        pattern,
        "type",
        objects);
  }

  /**
   * Runs a {@code (SCHEMA_NAME, NAME[, KIND])} query filtered by one bound name pattern and
   * appends results — {@code fixedKind} is used verbatim when given, otherwise the row's own
   * {@code KIND} column is read (procedures/functions distinguish kind per row).
   */
  private static void appendNameFilteredObjects(
      Connection connection, String sql, String pattern, String fixedKind, ArrayNode objects)
      throws SQLException {
    try (PreparedStatement statement = connection.prepareStatement(sql)) {
      statement.setMaxRows(FIND_OBJECTS_MAX_ROWS);
      statement.setString(1, pattern);
      try (ResultSet rs = statement.executeQuery()) {
        while (rs.next()) {
          String name = rs.getString("NAME");
          if (name == null || name.isBlank()) {
            continue;
          }
          ObjectNode object = objects.addObject();
          object.put("schemaName", rs.getString("SCHEMA_NAME"));
          object.put("name", name);
          object.put("kind", fixedKind != null ? fixedKind : rs.getString("KIND"));
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
      String requestedCatalog,
      String schemaName,
      String tableName,
      ArrayNode columns)
      throws SQLException {
    DatabaseMetaData metadata = connection.getMetaData();
    String catalog = connection.getCatalog();
    try (ResultSet rs = metadata.getColumns(catalog, schemaName, tableName, "%")) {
      MetadataColumns.appendFromResultSet(rs, columns);
    }
  }

  @Override
  public void collectRoutineArguments(
      Connection connection,
      String requestedCatalog,
      String schemaName,
      String routineName,
      String kind,
      ArrayNode arguments)
      throws SQLException {
    DatabaseMetaData metadata = connection.getMetaData();
    String catalog = connection.getCatalog();
    boolean isFunction = "function".equals(kind);
    try (ResultSet rs =
        isFunction
            ? metadata.getFunctionColumns(catalog, schemaName, routineName, "%")
            : metadata.getProcedureColumns(catalog, schemaName, routineName, "%")) {
      MetadataArguments.appendFromResultSet(rs, kind, arguments);
    }
  }

  @Override
  public String fetchTableComment(
      Connection connection, String catalog, String schemaName, String tableName)
      throws SQLException {
    // objsubid = 0 selects the relation's own comment (COMMENT ON TABLE/VIEW ...), not a
    // column's — pg_description rows for columns carry objsubid = column's attnum.
    String sql =
        "SELECT d.description AS COMMENT "
            + "FROM pg_catalog.pg_class c "
            + "JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace "
            + "LEFT JOIN pg_catalog.pg_description d ON d.objoid = c.oid AND d.objsubid = 0 "
            + "WHERE n.nspname = ? AND c.relname = ?";
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
      String requestedCatalog,
      String schemaName,
      String tableName,
      ArrayNode indexes)
      throws SQLException {
    DatabaseMetaData metadata = connection.getMetaData();
    String catalog = connection.getCatalog();
    try (ResultSet rs = metadata.getIndexInfo(catalog, schemaName, tableName, false, true)) {
      MetadataIndexes.appendFromResultSet(rs, indexes);
    }
  }

  @Override
  public void collectTableForeignKeys(
      Connection connection,
      String requestedCatalog,
      String schemaName,
      String tableName,
      ArrayNode foreignKeys)
      throws SQLException {
    DatabaseMetaData metadata = connection.getMetaData();
    String catalog = connection.getCatalog();
    try (ResultSet rs = metadata.getImportedKeys(catalog, schemaName, tableName)) {
      MetadataForeignKeys.appendFromResultSet(rs, foreignKeys);
    }
  }

  @Override
  public void collectTableReferences(
      Connection connection,
      String requestedCatalog,
      String schemaName,
      String tableName,
      ArrayNode references)
      throws SQLException {
    DatabaseMetaData metadata = connection.getMetaData();
    String catalog = connection.getCatalog();
    try (ResultSet rs = metadata.getExportedKeys(catalog, schemaName, tableName)) {
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
      Connection connection,
      String catalog,
      String schemaName,
      String tableName,
      ArrayNode triggers)
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
      Connection connection,
      String requestedCatalog,
      String schemaName,
      String tableName,
      ArrayNode keys)
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
      String catalog,
      String schemaName,
      String objectName,
      String kind,
      Boolean packageBody)
      throws SQLException {
    return switch (kind) {
      case "table" -> fetchPostgreSqlTableDdl(connection, schemaName, objectName);
      case "view" -> fetchPostgreSqlViewDdl(connection, schemaName, objectName);
      case "function", "procedure" -> fetchPostgreSqlRoutineDdl(connection, schemaName, objectName);
      case "trigger" -> fetchPostgreSqlTriggerDdl(connection, schemaName, objectName);
      default -> throw new RuntimeException("Unsupported object kind for DDL: " + kind);
    };
  }

  /**
   * Trigger names are only unique per-table in Postgres (not per-schema), so a schema+name pair
   * can in principle match more than one — takes the first, same "good enough for a single
   * schema-scoped lookup" tradeoff the Explorer's own trigger listing already makes.
   * {@code tgisinternal} excludes the hidden triggers Postgres creates to back constraints
   * (foreign keys, etc.) — those aren't independently addressable objects.
   */
  private String fetchPostgreSqlTriggerDdl(
      Connection connection, String schemaName, String objectName) throws SQLException {
    String sql =
        "SELECT pg_get_triggerdef(t.oid, true) "
            + "FROM pg_catalog.pg_trigger t "
            + "JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid "
            + "JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace "
            + "WHERE n.nspname = ? AND t.tgname = ? AND NOT t.tgisinternal";
    try (PreparedStatement statement = connection.prepareStatement(sql)) {
      statement.setString(1, schemaName);
      statement.setString(2, objectName);
      try (ResultSet rs = statement.executeQuery()) {
        String ddl = MetadataDdl.readFirstColumnAsString(rs);
        if (ddl == null) {
          return null;
        }
        ddl = ddl.trim();
        return ddl.endsWith(";") ? ddl : ddl + ";";
      }
    }
  }

  private String fetchPostgreSqlViewDdl(
      Connection connection, String schemaName, String objectName) throws SQLException {
    String sql =
        "SELECT pg_get_viewdef(c.oid, true) "
            + "FROM pg_catalog.pg_class c "
            + "JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace "
            + "WHERE n.nspname = ? AND c.relname = ? AND c.relkind IN ('v', 'm')";
    String definition;
    try (PreparedStatement statement = connection.prepareStatement(sql)) {
      statement.setString(1, schemaName);
      statement.setString(2, objectName);
      try (ResultSet rs = statement.executeQuery()) {
        definition = MetadataDdl.readFirstColumnAsString(rs);
      }
    }
    if (definition == null || definition.isBlank()) {
      return definition;
    }
    // pg_get_viewdef returns the bare SELECT (some Postgres versions include its own trailing
    // ';', others don't — strip it either way rather than risk a doubled ";;") — wrap it in a
    // CREATE OR REPLACE VIEW header so this round-trips through the same "Save" path as every
    // other object kind (which requires the buffer to start with CREATE) and so the DDL viewer
    // shows a complete, directly-executable statement rather than a headless query.
    String selectBody = definition.stripTrailing();
    if (selectBody.endsWith(";")) {
      selectBody = selectBody.substring(0, selectBody.length() - 1).stripTrailing();
    }
    String qualifiedName = quoteIdent(schemaName) + "." + quoteIdent(objectName);
    String viewDdl = "CREATE OR REPLACE VIEW " + qualifiedName + " AS\n" + selectBody;

    // COMMENT ON VIEW/COLUMN doesn't touch the query itself, so it's appended (rather than
    // baked into pg_get_viewdef's output) as trailing statements after a terminating ';' — the
    // frontend's Save path (buildPlsqlSaveSql) splits a VIEW buffer on statement boundaries and
    // replays each one in order, specifically so this round-trips: editing/saving the view keeps
    // reapplying whatever comments are still present in the buffer, which is also what makes this
    // safe for Postgres (CREATE OR REPLACE VIEW itself already preserves existing comments, so
    // this is a no-op reapplication, not a workaround for lost comments).
    String tableComment = fetchTableComment(connection, null, schemaName, objectName);
    ArrayNode columns = JsonNodeFactory.instance.arrayNode();
    collectTableColumns(connection, null, schemaName, objectName, columns);

    StringBuilder ddl = new StringBuilder(viewDdl);
    boolean terminated = false;
    if (tableComment != null && !tableComment.isBlank()) {
      ddl.append(";\n\n");
      terminated = true;
      ddl.append("COMMENT ON VIEW ")
          .append(qualifiedName)
          .append(" IS ")
          .append(MetadataDdl.quoteStringLiteral(tableComment))
          .append(";");
    }
    for (JsonNode column : columns) {
      String comment = column.path("comment").asText("");
      if (comment.isBlank()) {
        continue;
      }
      ddl.append(terminated ? "\n\n" : ";\n\n");
      terminated = true;
      ddl.append("COMMENT ON COLUMN ")
          .append(qualifiedName)
          .append(".")
          .append(quoteIdent(column.path("name").asText("")))
          .append(" IS ")
          .append(MetadataDdl.quoteStringLiteral(comment))
          .append(";");
    }

    return ddl.toString();
  }

  private static String quoteIdent(String identifier) {
    return "\"" + identifier.replace("\"", "\"\"") + "\"";
  }

  @Override
  public String quoteIdentifier(String raw) {
    return quoteIdent(raw);
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
    String columnsSql =
        "SELECT '    ' || quote_ident(a.attname) || ' ' || "
            + "       pg_catalog.format_type(a.atttypid, a.atttypmod) || "
            + "       CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END AS COLUMN_DEF "
            + "FROM pg_catalog.pg_attribute a "
            + "JOIN pg_catalog.pg_class c ON c.oid = a.attrelid "
            + "JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace "
            + "WHERE n.nspname = ? AND c.relname = ? AND a.attnum > 0 AND NOT a.attisdropped "
            + "  AND c.relkind IN ('r', 'p') "
            + "ORDER BY a.attnum";
    List<String> columnLines = new ArrayList<>();
    try (PreparedStatement statement = connection.prepareStatement(columnsSql)) {
      statement.setString(1, schemaName);
      statement.setString(2, objectName);
      try (ResultSet rs = statement.executeQuery()) {
        while (rs.next()) {
          columnLines.add(rs.getString("COLUMN_DEF"));
        }
      }
    }
    if (columnLines.isEmpty()) {
      return null;
    }

    ArrayNode constraints = JsonNodeFactory.instance.arrayNode();
    collectTableConstraints(connection, null, schemaName, objectName, constraints);
    ArrayNode foreignKeys = JsonNodeFactory.instance.arrayNode();
    collectTableForeignKeys(connection, null, schemaName, objectName, foreignKeys);
    ArrayNode indexes = JsonNodeFactory.instance.arrayNode();
    collectTableIndexes(connection, null, schemaName, objectName, indexes);
    ArrayNode columns = JsonNodeFactory.instance.arrayNode();
    collectTableColumns(connection, null, schemaName, objectName, columns);
    String tableComment = fetchTableComment(connection, null, schemaName, objectName);

    String qualifiedName = quoteIdent(schemaName) + "." + quoteIdent(objectName);
    List<String> tableLines = new ArrayList<>(columnLines);
    Set<String> constraintBackedIndexNames = new LinkedHashSet<>();
    for (JsonNode constraint : constraints) {
      String type = constraint.path("type").asText("");
      String name = constraint.path("name").asText("");
      if (!name.isBlank()) {
        constraintBackedIndexNames.add(name);
      }
      switch (type) {
        case "primaryKey" ->
            tableLines.add(
                "    CONSTRAINT "
                    + quoteIdent(name)
                    + " PRIMARY KEY ("
                    + MetadataDdl.joinQuotedColumns(constraint.path("columns"), this::quoteIdentifier)
                    + ")");
        case "unique" ->
            tableLines.add(
                "    CONSTRAINT "
                    + quoteIdent(name)
                    + " UNIQUE ("
                    + MetadataDdl.joinQuotedColumns(constraint.path("columns"), this::quoteIdentifier)
                    + ")");
        case "check" ->
            tableLines.add(
                "    CONSTRAINT "
                    + quoteIdent(name)
                    + " CHECK "
                    + constraint.path("expression").asText(""));
        default -> {}
      }
    }

    StringBuilder ddl = new StringBuilder();
    ddl.append("CREATE TABLE ").append(qualifiedName).append(" (\n");
    ddl.append(String.join(",\n", tableLines));
    ddl.append("\n);");

    for (JsonNode fk : foreignKeys) {
      ddl.append("\n\n")
          .append(
              MetadataDdl.buildAddForeignKeyStatement(
                  qualifiedName, fk, this::quoteIdentifier, schemaName));
    }

    for (JsonNode index : indexes) {
      String indexName = index.path("name").asText("");
      if (indexName.isBlank() || constraintBackedIndexNames.contains(indexName)) {
        continue;
      }
      boolean unique = index.path("unique").asBoolean(false);
      ddl.append("\n\n")
          .append("CREATE ")
          .append(unique ? "UNIQUE " : "")
          .append("INDEX ")
          .append(quoteIdent(indexName))
          .append(" ON ")
          .append(qualifiedName)
          .append(" (")
          .append(MetadataDdl.joinQuotedColumns(index.path("columns"), this::quoteIdentifier))
          .append(");");
    }

    if (tableComment != null && !tableComment.isBlank()) {
      ddl.append("\n\n")
          .append("COMMENT ON TABLE ")
          .append(qualifiedName)
          .append(" IS ")
          .append(MetadataDdl.quoteStringLiteral(tableComment))
          .append(";");
    }

    for (JsonNode column : columns) {
      String comment = column.path("comment").asText("");
      if (comment.isBlank()) {
        continue;
      }
      ddl.append("\n\n")
          .append("COMMENT ON COLUMN ")
          .append(qualifiedName)
          .append(".")
          .append(quoteIdent(column.path("name").asText("")))
          .append(" IS ")
          .append(MetadataDdl.quoteStringLiteral(comment))
          .append(";");
    }

    return ddl.toString();
  }
}
