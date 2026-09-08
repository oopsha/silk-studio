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
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** SQLite's file-backed dialect. SQLite schemas are attached database names (`main`, `temp`, …). */
final class SqliteDialect implements DbDialect {
  @Override
  public String id() {
    return "sqlite";
  }

  @Override
  public boolean matchesUrl(String normalizedUrl) {
    return normalizedUrl.startsWith("jdbc:sqlite:");
  }

  @Override
  public void testConnection(Connection connection, int timeoutSeconds) throws SQLException {
    runTestQuery(connection, timeoutSeconds, "SELECT 1");
  }

  @Override
  public void afterConnect(Connection connection, JsonNode params) throws SQLException {
    // SQLite leaves foreign-key enforcement off unless every connection explicitly enables it.
    // A short busy timeout gives another local writer time to finish instead of immediately
    // surfacing SQLITE_BUSY to the user.
    try (Statement statement = connection.createStatement()) {
      statement.execute("PRAGMA foreign_keys = ON");
      statement.execute("PRAGMA busy_timeout = 5000");
    }
  }

  @Override
  public List<String> listSchemaNames(Connection connection, String ignoredCatalog) throws SQLException {
    List<String> schemas = new ArrayList<>();
    try (Statement statement = connection.createStatement();
        ResultSet rs = statement.executeQuery("PRAGMA database_list")) {
      while (rs.next()) {
        String name = rs.getString("name");
        if (name != null && !name.isBlank()) {
          schemas.add(name);
        }
      }
    }
    return schemas;
  }

  @Override
  public void collectSchemaObjects(
      Connection connection,
      String ignoredCatalog,
      String schemaName,
      boolean includeSecondaryKinds,
      ArrayNode objects)
      throws SQLException {
    String schema = usableSchema(schemaName);
    String sql =
        "SELECT name, type FROM " + quoteIdent(schema) + ".sqlite_schema "
            + "WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name";
    try (Statement statement = connection.createStatement(); ResultSet rs = statement.executeQuery(sql)) {
      while (rs.next()) {
        appendObject(objects, rs.getString("name"), rs.getString("type"));
      }
    }
    if (!includeSecondaryKinds) {
      return;
    }
    String secondarySql =
        "SELECT name, type FROM " + quoteIdent(schema) + ".sqlite_schema "
            + "WHERE type IN ('index', 'trigger') AND name NOT LIKE 'sqlite_%' ORDER BY name";
    try (Statement statement = connection.createStatement(); ResultSet rs = statement.executeQuery(secondarySql)) {
      while (rs.next()) {
        appendObject(objects, rs.getString("name"), rs.getString("type"));
      }
    }
  }

  @Override
  public void findObjectsByName(
      Connection connection,
      String ignoredCatalog,
      String name,
      boolean contains,
      java.util.Set<String> kinds,
      boolean includeSystemObjects,
      ArrayNode objects)
      throws SQLException {
    String comparator = contains ? "LIKE ? ESCAPE '\\'" : "= ?";
    String value = contains ? LikeEscape.containsPattern(name) : name;
    for (String schema : listSchemaNames(connection, null)) {
      if (!includeSystemObjects && "temp".equalsIgnoreCase(schema)) {
        continue;
      }
      String sql =
          "SELECT name, type FROM " + quoteIdent(schema) + ".sqlite_schema "
              + "WHERE type IN ('table', 'view', 'index', 'trigger') AND name " + comparator
              + " AND name NOT LIKE 'sqlite_%'";
      try (PreparedStatement statement = connection.prepareStatement(sql)) {
        statement.setMaxRows(FIND_OBJECTS_MAX_ROWS);
        statement.setQueryTimeout(FIND_OBJECTS_TIMEOUT_SECONDS);
        statement.setString(1, value);
        try (ResultSet rs = statement.executeQuery()) {
          while (rs.next()) {
            String kind = rs.getString("type");
            if (kinds != null && !kinds.isEmpty() && !kinds.contains(kind)) continue;
            String objectName = rs.getString("name");
            if (objectName == null || objectName.isBlank()) continue;
            ObjectNode object = objects.addObject();
            object.put("schemaName", schema);
            object.put("name", objectName);
            object.put("kind", kind);
          }
        }
      }
    }
  }

  @Override
  public void collectTableColumns(
      Connection connection, String ignoredCatalog, String schemaName, String tableName, ArrayNode columns)
      throws SQLException {
    String schema = usableSchema(schemaName);
    Map<String, String> comments = sqliteColumnComments(readSqliteObjectSql(connection, schema, tableName, "table"));
    String sql = "PRAGMA " + quoteIdent(schema) + ".table_xinfo(" + stringLiteral(tableName) + ")";
    try (Statement statement = connection.createStatement(); ResultSet rs = statement.executeQuery(sql)) {
      while (rs.next()) {
        ObjectNode column = columns.addObject();
        column.put("name", rs.getString("name"));
        String type = rs.getString("type");
        if (type != null && !type.isBlank()) column.put("typeName", type);
        column.put("nullable", rs.getInt("notnull") == 0);
        String defaultValue = rs.getString("dflt_value");
        if (defaultValue != null) column.put("defaultValue", defaultValue);
        String comment = comments.get(rs.getString("name"));
        if (comment != null) column.put("comment", comment);
        column.put("position", rs.getInt("cid") + 1);
        // 2/3 are SQLite generated columns; 1 is a hidden virtual-table column.
        column.put("generated", rs.getInt("hidden") >= 2);
      }
    }
  }

  @Override
  public void collectTableIndexes(
      Connection connection, String ignoredCatalog, String schemaName, String tableName, ArrayNode indexes)
      throws SQLException {
    String schema = usableSchema(schemaName);
    String sql = "PRAGMA " + quoteIdent(schema) + ".index_list(" + stringLiteral(tableName) + ")";
    try (Statement statement = connection.createStatement(); ResultSet rs = statement.executeQuery(sql)) {
      while (rs.next()) {
        String name = rs.getString("name");
        if (name == null || name.isBlank()) continue;
        ObjectNode index = indexes.addObject();
        index.put("name", name);
        index.put("unique", rs.getInt("unique") != 0);
        ArrayNode names = index.putArray("columns");
        appendIndexColumns(connection, schema, name, names);
      }
    }
  }

  @Override
  public void collectTableForeignKeys(
      Connection connection, String ignoredCatalog, String schemaName, String tableName, ArrayNode foreignKeys)
      throws SQLException {
    appendForeignKeys(connection, usableSchema(schemaName), tableName, foreignKeys, null);
  }

  @Override
  public void collectTableReferences(
      Connection connection, String ignoredCatalog, String schemaName, String tableName, ArrayNode references)
      throws SQLException {
    String schema = usableSchema(schemaName);
    for (String candidate : listTableNames(connection, schema)) {
      ArrayNode foreignKeys = com.fasterxml.jackson.databind.node.JsonNodeFactory.instance.arrayNode();
      appendForeignKeys(connection, schema, candidate, foreignKeys, tableName);
      for (JsonNode foreignKey : foreignKeys) {
        ObjectNode reference = references.addObject();
        reference.put("name", foreignKey.path("name").asText());
        reference.put("referencingSchema", schema);
        reference.put("referencingTable", candidate);
        reference.set("columns", foreignKey.path("referencedColumns"));
        reference.set("referencingColumns", foreignKey.path("columns"));
        if (foreignKey.has("updateRule")) reference.set("updateRule", foreignKey.get("updateRule"));
        if (foreignKey.has("deleteRule")) reference.set("deleteRule", foreignKey.get("deleteRule"));
      }
    }
  }

  @Override
  public void collectRoutineArguments(
      Connection connection, String catalog, String schemaName, String routineName, String kind, ArrayNode arguments) {}

  @Override
  public void collectTableConstraints(
      Connection connection, String catalog, String schemaName, String tableName, ArrayNode constraints)
      throws SQLException {
    String schema = usableSchema(schemaName);
    ArrayNode keys = com.fasterxml.jackson.databind.node.JsonNodeFactory.instance.arrayNode();
    collectPrimaryKeys(connection, null, schema, tableName, keys);
    if (!keys.isEmpty()) {
      ObjectNode primaryKey = constraints.addObject();
      primaryKey.put("name", "pk_" + tableName);
      primaryKey.put("type", "primaryKey");
      primaryKey.set("columns", keys);
    }
    String sql = "PRAGMA " + quoteIdent(schema) + ".index_list(" + stringLiteral(tableName) + ")";
    try (Statement statement = connection.createStatement(); ResultSet rs = statement.executeQuery(sql)) {
      while (rs.next()) {
        if (rs.getInt("unique") == 0 || !"u".equals(rs.getString("origin"))) continue;
        String name = rs.getString("name");
        if (name == null || name.isBlank()) continue;
        ObjectNode unique = constraints.addObject();
        unique.put("name", name);
        unique.put("type", "unique");
        ArrayNode names = unique.putArray("columns");
        appendIndexColumns(connection, schema, name, names);
      }
    }
  }

  @Override
  public void collectTableTriggers(
      Connection connection, String catalog, String schemaName, String tableName, ArrayNode triggers)
      throws SQLException {
    String sql =
        "SELECT name AS NAME, NULL AS TIMING, NULL AS EVENT, 1 AS ENABLED FROM "
            + quoteIdent(usableSchema(schemaName)) + ".sqlite_schema WHERE type = 'trigger' AND tbl_name = ?";
    try (PreparedStatement statement = connection.prepareStatement(sql)) {
      statement.setString(1, tableName);
      try (ResultSet rs = statement.executeQuery()) {
        MetadataTriggers.appendFromResultSet(rs, triggers);
      }
    }
  }

  @Override
  public String collectPrimaryKeys(
      Connection connection, String catalog, String schemaName, String tableName, ArrayNode keys)
      throws SQLException {
    keys.removeAll();
    TreeMap<Integer, String> byPosition = new TreeMap<>();
    String sql = "PRAGMA " + quoteIdent(usableSchema(schemaName)) + ".table_xinfo(" + stringLiteral(tableName) + ")";
    try (Statement statement = connection.createStatement(); ResultSet rs = statement.executeQuery(sql)) {
      while (rs.next()) {
        int position = rs.getInt("pk");
        if (position > 0) byPosition.put(position, rs.getString("name"));
      }
    }
    for (String name : byPosition.values()) keys.addObject().put("name", name);
    return byPosition.isEmpty() ? null : usableSchema(schemaName);
  }

  @Override
  public List<MetadataGroupId> supportedGroups() {
    return List.of(MetadataGroupId.TABLES, MetadataGroupId.VIEWS, MetadataGroupId.INDEXES, MetadataGroupId.TRIGGERS);
  }

  @Override
  public String fetchObjectDdl(
      Connection connection, String catalog, String schemaName, String objectName, String kind, Boolean packageBody)
      throws SQLException {
    if (!("table".equals(kind) || "view".equals(kind) || "index".equals(kind) || "trigger".equals(kind))) {
      throw new RuntimeException("Unsupported object kind for DDL: " + kind);
    }
    return readSqliteObjectSql(connection, usableSchema(schemaName), objectName, kind);
  }

  @Override
  public String fetchTableComment(
      Connection connection, String catalog, String schemaName, String tableName) throws SQLException {
    String ddl = readSqliteObjectSql(connection, usableSchema(schemaName), tableName, "table");
    if (ddl == null) return null;
    // SQLite has no COMMENT ON syntax. Comments directly following the table name are a
    // deliberate convention kept verbatim in sqlite_schema.sql. Support both common SQL
    // comment forms, but only as metadata to display; this dialect never rewrites them.
    Matcher matcher = TABLE_COMMENT.matcher(ddl);
    if (matcher.find()) return normalizeComment(matcher.group(1));
    matcher = TABLE_LINE_COMMENT.matcher(ddl);
    return matcher.find() ? normalizeComment(matcher.group(1)) : null;
  }

  private static String readSqliteObjectSql(
      Connection connection, String schema, String objectName, String kind) throws SQLException {
    String sql = "SELECT sql FROM " + quoteIdent(schema) + ".sqlite_schema WHERE name = ? AND type = ?";
    try (PreparedStatement statement = connection.prepareStatement(sql)) {
      statement.setString(1, objectName);
      statement.setString(2, kind);
      try (ResultSet rs = statement.executeQuery()) {
        return MetadataDdl.readFirstColumnAsString(rs);
      }
    }
  }

  @Override
  public String quoteIdentifier(String raw) {
    return quoteIdent(raw);
  }

  @Override
  public String wrapPagedQuery(String innerSql, String whereFragment, String orderByFragment, int offset, int limit) {
    StringBuilder sql = new StringBuilder("SELECT * FROM (").append(innerSql).append(") sq");
    if (whereFragment != null && !whereFragment.isBlank()) sql.append(" WHERE ").append(whereFragment);
    if (orderByFragment != null && !orderByFragment.isBlank()) sql.append(" ORDER BY ").append(orderByFragment);
    return sql.append(" LIMIT ").append(limit).append(" OFFSET ").append(offset).toString();
  }

  private static void appendObject(ArrayNode objects, String name, String kind) {
    if (name == null || name.isBlank()) return;
    ObjectNode object = objects.addObject();
    object.put("name", name);
    object.put("kind", kind);
  }

  /** Appends key columns only: SQLite's index_xinfo also reports rowid and expression payloads. */
  private static void appendIndexColumns(
      Connection connection, String schema, String indexName, ArrayNode columns) throws SQLException {
    String sql = "PRAGMA " + quoteIdent(schema) + ".index_xinfo(" + stringLiteral(indexName) + ")";
    TreeMap<Integer, String> byPosition = new TreeMap<>();
    try (Statement statement = connection.createStatement(); ResultSet rs = statement.executeQuery(sql)) {
      while (rs.next()) {
        if (rs.getInt("key") == 0) continue;
        String column = rs.getString("name");
        if (column != null && !column.isBlank()) byPosition.put(rs.getInt("seqno"), column);
      }
    }
    for (String column : byPosition.values()) columns.add(column);
  }

  /** SQLite PRAGMA foreign_key_list has no constraint name, so create a stable per-table id. */
  private static void appendForeignKeys(
      Connection connection,
      String schema,
      String tableName,
      ArrayNode foreignKeys,
      String referencedTableFilter)
      throws SQLException {
    record ForeignKey(
        int id,
        String table,
        String updateRule,
        String deleteRule,
        TreeMap<Integer, String> columns,
        TreeMap<Integer, String> referencedColumns) {}
    Map<Integer, ForeignKey> byId = new LinkedHashMap<>();
    String sql = "PRAGMA " + quoteIdent(schema) + ".foreign_key_list(" + stringLiteral(tableName) + ")";
    try (Statement statement = connection.createStatement(); ResultSet rs = statement.executeQuery(sql)) {
      while (rs.next()) {
        String referencedTable = rs.getString("table");
        if (referencedTableFilter != null && !referencedTableFilter.equals(referencedTable)) continue;
        int id = rs.getInt("id");
        ForeignKey foreignKey = byId.get(id);
        if (foreignKey == null) {
          foreignKey = new ForeignKey(
              id,
              referencedTable,
              rs.getString("on_update"),
              rs.getString("on_delete"),
              new TreeMap<>(),
              new TreeMap<>());
          byId.put(id, foreignKey);
        }
        int sequence = rs.getInt("seq");
        foreignKey.columns().put(sequence, rs.getString("from"));
        foreignKey.referencedColumns().put(sequence, rs.getString("to"));
      }
    }
    for (ForeignKey foreignKey : byId.values()) {
      ObjectNode output = foreignKeys.addObject();
      output.put("name", "fk_" + tableName + "_" + foreignKey.id());
      output.put("referencedSchema", schema);
      output.put("referencedTable", foreignKey.table() == null ? "" : foreignKey.table());
      ArrayNode columns = output.putArray("columns");
      for (String column : foreignKey.columns().values()) columns.add(column);
      ArrayNode referencedColumns = output.putArray("referencedColumns");
      for (String column : foreignKey.referencedColumns().values()) referencedColumns.add(column);
      if (foreignKey.updateRule() != null && !foreignKey.updateRule().isBlank()) {
        output.put("updateRule", foreignKey.updateRule());
      }
      if (foreignKey.deleteRule() != null && !foreignKey.deleteRule().isBlank()) {
        output.put("deleteRule", foreignKey.deleteRule());
      }
    }
  }

  private static List<String> listTableNames(Connection connection, String schema) throws SQLException {
    List<String> names = new ArrayList<>();
    String sql = "SELECT name FROM " + quoteIdent(schema) + ".sqlite_schema "
        + "WHERE type = 'table' AND name NOT LIKE 'sqlite_%'";
    try (Statement statement = connection.createStatement(); ResultSet rs = statement.executeQuery(sql)) {
      while (rs.next()) names.add(rs.getString(1));
    }
    return names;
  }

  private static String usableSchema(String schemaName) {
    return schemaName == null || schemaName.isBlank() ? "main" : schemaName;
  }

  private static String quoteIdent(String value) {
    return "\"" + value.replace("\"", "\"\"") + "\"";
  }

  private static String stringLiteral(String value) {
    return "'" + value.replace("'", "''") + "'";
  }

  private static final Pattern TABLE_COMMENT = Pattern.compile(
      "(?is)^\\s*CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:\\\"[^\\\"]+\\\"|`[^`]+`|\\[[^]]+]|[\\w$]+)\\s*/\\*\\s*(.*?)\\s*\\*/");
  private static final Pattern TABLE_LINE_COMMENT = Pattern.compile(
      "(?im)^\\s*CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:\\\"[^\\\"]+\\\"|`[^`]+`|\\[[^]]+]|[\\w$]+)\\s*--\\s*(.+?)\\s*$");
  private static final Pattern BLOCK_COMMENT = Pattern.compile("(?s)/\\*\\s*(.*?)\\s*\\*/");
  private static final Pattern LINE_COMMENT = Pattern.compile("(?m)--\\s*(.+?)\\s*$", Pattern.MULTILINE);
  private static final Pattern LEADING_IDENTIFIER = Pattern.compile(
      "^\\s*(?:\\\"([^\\\"]+)\\\"|`([^`]+)`|\\[([^]]+)]|([\\w$]+))(?:\\s|$)");

  /** Parses comments attached to top-level column declarations in a CREATE TABLE statement. */
  private static Map<String, String> sqliteColumnComments(String ddl) {
    Map<String, String> comments = new LinkedHashMap<>();
    if (ddl == null) return comments;
    // The common SQLite style puts the delimiter before the line comment:
    // `column TEXT NOT NULL, -- description`. Do this line-by-line rather than with one large
    // regex: RENAME COLUMN quotes the renamed identifier, and a regex tied to the original
    // whitespace/identifier layout would silently lose its displayed comment.
    for (String line : ddl.split("\\R")) {
      int commentStart = line.indexOf("--");
      if (commentStart < 0) continue;
      String declaration = line.substring(0, commentStart).trim();
      if (declaration.endsWith(",")) {
        declaration = declaration.substring(0, declaration.length() - 1).trim();
      }
      Matcher name = LEADING_IDENTIFIER.matcher(declaration);
      if (!name.find()) continue;
      String columnName = firstNonNull(name.group(1), name.group(2), name.group(3), name.group(4));
      String upper = columnName.toUpperCase(java.util.Locale.ROOT);
      if (upper.equals("CONSTRAINT") || upper.equals("PRIMARY") || upper.equals("FOREIGN")
          || upper.equals("UNIQUE") || upper.equals("CHECK")) continue;
      String comment = normalizeComment(line.substring(commentStart + 2));
      if (!comment.isBlank()) comments.put(columnName, comment);
    }
    int open = ddl.indexOf('(');
    int close = ddl.lastIndexOf(')');
    if (open < 0 || close <= open) return comments;
    for (String declaration : ddl.substring(open + 1, close).split(",(?=(?:[^()]*\\([^()]*\\))*[^()]*$)")) {
      String trimmed = declaration.trim();
      String upper = trimmed.toUpperCase(java.util.Locale.ROOT);
      if (upper.startsWith("CONSTRAINT") || upper.startsWith("PRIMARY") || upper.startsWith("FOREIGN")
          || upper.startsWith("UNIQUE") || upper.startsWith("CHECK")) continue;
      Matcher name = LEADING_IDENTIFIER.matcher(trimmed);
      if (!name.find()) continue;
      String columnName = name.group(1) != null ? name.group(1) : name.group(2) != null ? name.group(2)
          : name.group(3) != null ? name.group(3) : name.group(4);
      Matcher block = BLOCK_COMMENT.matcher(trimmed);
      Matcher line = LINE_COMMENT.matcher(trimmed);
      String text = block.find() ? block.group(1) : line.find() ? line.group(1) : null;
      if (text != null && !normalizeComment(text).isBlank()) comments.putIfAbsent(columnName, normalizeComment(text));
    }
    return comments;
  }

  private static String normalizeComment(String value) {
    return value.replaceAll("(?m)^\\s*\\*?\\s?", "").trim();
  }

  private static String firstNonNull(String... values) {
    for (String value : values) if (value != null) return value;
    return "";
  }
}
