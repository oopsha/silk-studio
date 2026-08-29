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
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;

/** Oracle Database (ojdbc11) dialect. This is the original, pre-abstraction behavior. */
final class OracleDialect implements DbDialect {
  @Override
  public String id() {
    return "oracle";
  }

  @Override
  public boolean matchesUrl(String normalizedUrl) {
    return normalizedUrl.startsWith("jdbc:oracle:");
  }

  @Override
  public void testConnection(Connection connection, int timeoutSeconds) throws SQLException {
    runTestQuery(connection, timeoutSeconds, "SELECT 1 FROM DUAL");
  }

  @Override
  public void afterConnect(Connection connection, JsonNode params) throws SQLException {
    String schema = params.path("schema").asText("").trim();
    if (schema.isEmpty()) {
      return;
    }
    // Quote as an Oracle delimited identifier so mixed-case / special names work.
    String quoted = "\"" + schema.replace("\"", "\"\"") + "\"";
    try (Statement statement = connection.createStatement()) {
      statement.execute("ALTER SESSION SET CURRENT_SCHEMA = " + quoted);
    }
  }

  @Override
  public List<MetadataGroupId> supportedGroups() {
    return List.of(
        MetadataGroupId.TABLES,
        MetadataGroupId.VIEWS,
        MetadataGroupId.PACKAGES,
        MetadataGroupId.PROCEDURES,
        MetadataGroupId.FUNCTIONS,
        MetadataGroupId.INDEXES,
        MetadataGroupId.SEQUENCES,
        MetadataGroupId.SYNONYMS,
        MetadataGroupId.TRIGGERS,
        MetadataGroupId.TYPES);
  }

  @Override
  public List<String> listSchemaNames(Connection connection, String catalog) throws SQLException {
    // Oracle has no catalog concept; `catalog` is intentionally unused.
    Set<String> names = new LinkedHashSet<>();
    try (ResultSet schemas = connection.getMetaData().getSchemas()) {
      while (schemas.next()) {
        String name = schemas.getString("TABLE_SCHEM");
        if (name != null && !name.isBlank()) {
          names.add(name);
        }
      }
    }

    if (names.isEmpty()) {
      String currentUser = connection.getMetaData().getUserName();
      if (currentUser != null && !currentUser.isBlank()) {
        names.add(currentUser);
      }
    }

    return new ArrayList<>(names);
  }

  /**
   * Queries {@code ALL_TAB_COLUMNS}/{@code ALL_COL_COMMENTS} directly instead of JDBC's {@code
   * getColumns} — like {@link #collectRoutineArguments}, the standard JDBC metadata call is
   * dramatically slower on Oracle's driver than a direct dictionary query (confirmed against
   * DBeaver, which does the same). This is the tab users hit first opening a table, so it's the
   * one most worth fixing.
   */
  private static final String ORACLE_COLUMNS_SQL_BASE =
      "SELECT c.COLUMN_NAME, c.DATA_TYPE, c.DATA_LENGTH, c.DATA_PRECISION, c.DATA_SCALE, "
          + "c.CHAR_LENGTH, c.NULLABLE, c.DATA_DEFAULT, c.COLUMN_ID%s, cm.COMMENTS "
          + "FROM ALL_TAB_COLUMNS c "
          + "LEFT JOIN ALL_COL_COMMENTS cm "
          + "  ON cm.OWNER = c.OWNER AND cm.TABLE_NAME = c.TABLE_NAME "
          + "  AND cm.COLUMN_NAME = c.COLUMN_NAME "
          + "WHERE c.OWNER = ? AND c.TABLE_NAME = ? "
          + "ORDER BY c.COLUMN_ID";

  /**
   * {@code IDENTITY_COLUMN}/{@code VIRTUAL_COLUMN} were added to {@code ALL_TAB_COLUMNS} in
   * Oracle 12c/11g respectively — old enough that every real Oracle instance should have them,
   * but some Oracle-compatible/legacy targets in the wild don't (confirmed by a user hitting
   * ORA-00904 on {@code VIRTUAL_COLUMN}). Rather than gate on a version probe, just try with them
   * first and drop both on that specific failure.
   *
   * <p>Deliberately re-checked on every call rather than cached on this dialect instance — {@code
   * DbDialects} holds a single shared {@code OracleDialect} across every Oracle connection in the
   * process, so a per-instance flag would leak a fallback triggered by one (old/nonstandard)
   * target into unrelated sessions against normal Oracle instances.
   */
  @Override
  public void collectTableColumns(
      Connection connection,
      String catalog,
      String schemaName,
      String tableName,
      ArrayNode columns)
      throws SQLException {
    for (String schema : distinctCases(schemaName)) {
      for (String table : distinctCases(tableName)) {
        try {
          executeOracleColumnsQuery(connection, schema, table, columns, true);
        } catch (SQLException error) {
          if (error.getErrorCode() != 904) {
            throw error;
          }
          executeOracleColumnsQuery(connection, schema, table, columns, false);
        }
        if (columns.size() > 0) {
          return;
        }
      }
    }
  }

  private static void executeOracleColumnsQuery(
      Connection connection,
      String schema,
      String table,
      ArrayNode columns,
      boolean withIdentityVirtual)
      throws SQLException {
    String sql =
        String.format(
            ORACLE_COLUMNS_SQL_BASE, withIdentityVirtual ? ", c.IDENTITY_COLUMN, c.VIRTUAL_COLUMN" : "");
    try (PreparedStatement statement = connection.prepareStatement(sql)) {
      statement.setString(1, schema);
      statement.setString(2, table);
      try (ResultSet rs = statement.executeQuery()) {
        while (rs.next()) {
          appendOracleColumn(rs, columns, withIdentityVirtual);
        }
      }
    }
  }

  private static void appendOracleColumn(
      ResultSet rs, ArrayNode columns, boolean withIdentityVirtual) throws SQLException {
    String name = rs.getString("COLUMN_NAME");
    if (name == null || name.isBlank()) {
      return;
    }
    ObjectNode column = columns.addObject();
    column.put("name", name);

    String dataType = rs.getString("DATA_TYPE");
    if (dataType != null && !dataType.isBlank()) {
      column.put("typeName", dataType);
    }
    String upperType = dataType == null ? "" : dataType.toUpperCase(Locale.ROOT);
    Integer columnSize = null;
    Integer decimalDigits = null;
    if (upperType.startsWith("NUMBER") || upperType.startsWith("FLOAT")) {
      columnSize = rs.getObject("DATA_PRECISION", Integer.class);
      decimalDigits = rs.getObject("DATA_SCALE", Integer.class);
    } else if (upperType.contains("CHAR")) {
      columnSize = rs.getObject("CHAR_LENGTH", Integer.class);
    } else if (upperType.contains("RAW")) {
      columnSize = rs.getObject("DATA_LENGTH", Integer.class);
    }
    if (columnSize != null) {
      column.put("columnSize", columnSize);
    }
    if (decimalDigits != null) {
      column.put("decimalDigits", decimalDigits);
    }

    String nullable = rs.getString("NULLABLE");
    if ("Y".equalsIgnoreCase(nullable)) {
      column.put("nullable", true);
    } else if ("N".equalsIgnoreCase(nullable)) {
      column.put("nullable", false);
    }

    String defaultValue = rs.getString("DATA_DEFAULT");
    if (defaultValue != null) {
      // Oracle pads DATA_DEFAULT with a trailing newline/space for most literal defaults.
      String trimmed = defaultValue.strip();
      if (!trimmed.isEmpty()) {
        column.put("defaultValue", trimmed);
      }
    }

    String comment = rs.getString("COMMENTS");
    if (comment != null && !comment.isBlank()) {
      column.put("comment", comment);
    }

    Integer position = rs.getObject("COLUMN_ID", Integer.class);
    if (position != null) {
      column.put("position", position);
    }

    if (withIdentityVirtual) {
      if ("YES".equalsIgnoreCase(rs.getString("IDENTITY_COLUMN"))) {
        column.put("autoIncrement", true);
      }
      if ("YES".equalsIgnoreCase(rs.getString("VIRTUAL_COLUMN"))) {
        column.put("generated", true);
      }
    }
  }

  /**
   * Queries {@code ALL_ARGUMENTS} directly instead of JDBC's {@code getProcedureColumns}/
   * {@code getFunctionColumns} — those standard calls turned out to be dramatically slower on
   * Oracle's driver (confirmed by comparing against DBeaver, which also queries
   * {@code ALL_ARGUMENTS} directly here: {@code OracleProcedureBase.ArgumentsCache}). A
   * standalone procedure/function can't be overloaded in Oracle (only package members can), so
   * unlike DBeaver's version this doesn't need an {@code OVERLOAD} filter.
   */
  @Override
  public void collectRoutineArguments(
      Connection connection,
      String catalog,
      String schemaName,
      String routineName,
      String kind,
      ArrayNode arguments)
      throws SQLException {
    String sql =
        "SELECT ARGUMENT_NAME AS COLUMN_NAME, DATA_TYPE AS TYPE_NAME, IN_OUT, POSITION "
            + "FROM ALL_ARGUMENTS "
            + "WHERE OWNER = ? AND OBJECT_NAME = ? AND PACKAGE_NAME IS NULL AND DATA_LEVEL = 0 "
            + "ORDER BY POSITION";
    for (String schema : distinctCases(schemaName)) {
      for (String routine : distinctCases(routineName)) {
        try (PreparedStatement statement = connection.prepareStatement(sql)) {
          statement.setString(1, schema);
          statement.setString(2, routine);
          try (ResultSet rs = statement.executeQuery()) {
            while (rs.next()) {
              int position = rs.getInt("POSITION");
              ObjectNode argument = arguments.addObject();
              String name = rs.getString("COLUMN_NAME");
              if (name != null && !name.isBlank()) {
                argument.put("name", name);
              }
              String typeName = rs.getString("TYPE_NAME");
              if (typeName != null && !typeName.isBlank()) {
                argument.put("typeName", typeName);
              }
              argument.put("direction", oracleArgumentDirection(rs.getString("IN_OUT"), position));
              argument.put("position", position);
            }
          }
        }
        if (arguments.size() > 0) {
          return;
        }
      }
    }
  }

  /** {@code POSITION = 0} is always the routine's return value, regardless of {@code IN_OUT}. */
  private static String oracleArgumentDirection(String inOut, int position) {
    if (position == 0) return "return";
    if ("OUT".equals(inOut)) return "out";
    if ("IN".equals(inOut)) return "in";
    return "inout";
  }

  @Override
  public String fetchTableComment(
      Connection connection, String catalog, String schemaName, String tableName)
      throws SQLException {
    // ALL_TAB_COMMENTS covers both tables and views (TABLE_TYPE differs, name doesn't).
    String sql = "SELECT COMMENTS FROM ALL_TAB_COMMENTS WHERE OWNER = ? AND TABLE_NAME = ?";
    for (String schema : distinctCases(schemaName)) {
      for (String table : distinctCases(tableName)) {
        try (PreparedStatement statement = connection.prepareStatement(sql)) {
          statement.setString(1, schema);
          statement.setString(2, table);
          try (ResultSet rs = statement.executeQuery()) {
            if (rs.next()) {
              String comment = rs.getString("COMMENTS");
              if (comment != null && !comment.isBlank()) {
                return comment;
              }
            }
          }
        }
      }
    }
    return null;
  }

  /** Direct dictionary query — see {@link #collectTableColumns}'s doc comment for why. */
  @Override
  public void collectTableIndexes(
      Connection connection,
      String catalog,
      String schemaName,
      String tableName,
      ArrayNode indexes)
      throws SQLException {
    String sql =
        "SELECT ic.INDEX_NAME, ic.COLUMN_NAME, ic.COLUMN_POSITION, i.UNIQUENESS "
            + "FROM ALL_IND_COLUMNS ic "
            + "JOIN ALL_INDEXES i ON i.OWNER = ic.INDEX_OWNER AND i.INDEX_NAME = ic.INDEX_NAME "
            + "WHERE ic.TABLE_OWNER = ? AND ic.TABLE_NAME = ? "
            + "ORDER BY ic.INDEX_NAME, ic.COLUMN_POSITION";
    for (String schema : distinctCases(schemaName)) {
      for (String table : distinctCases(tableName)) {
        Map<String, TreeMap<Integer, String>> columnsByIndex = new LinkedHashMap<>();
        Map<String, Boolean> uniqueByIndex = new LinkedHashMap<>();
        try (PreparedStatement statement = connection.prepareStatement(sql)) {
          statement.setString(1, schema);
          statement.setString(2, table);
          try (ResultSet rs = statement.executeQuery()) {
            while (rs.next()) {
              String indexName = rs.getString("INDEX_NAME");
              String columnName = rs.getString("COLUMN_NAME");
              if (indexName == null || indexName.isBlank() || columnName == null || columnName.isBlank()) {
                continue;
              }
              columnsByIndex
                  .computeIfAbsent(indexName, key -> new TreeMap<>())
                  .put(rs.getInt("COLUMN_POSITION"), columnName);
              uniqueByIndex.put(indexName, "UNIQUE".equals(rs.getString("UNIQUENESS")));
            }
          }
        }
        for (Map.Entry<String, TreeMap<Integer, String>> entry : columnsByIndex.entrySet()) {
          ObjectNode index = indexes.addObject();
          index.put("name", entry.getKey());
          index.put("unique", Boolean.TRUE.equals(uniqueByIndex.get(entry.getKey())));
          ArrayNode indexColumns = index.putArray("columns");
          for (String column : entry.getValue().values()) {
            indexColumns.add(column);
          }
        }
        if (indexes.size() > 0) {
          return;
        }
      }
    }
  }

  /**
   * Direct {@code ALL_CONSTRAINTS}/{@code ALL_CONS_COLUMNS} query — see {@link
   * #collectTableColumns}'s doc comment for why. Oracle doesn't support {@code ON UPDATE} actions
   * on foreign keys at all, so unlike the other three dialects this never emits {@code
   * updateRule}.
   */
  @Override
  public void collectTableForeignKeys(
      Connection connection,
      String catalog,
      String schemaName,
      String tableName,
      ArrayNode foreignKeys)
      throws SQLException {
    String sql =
        "SELECT c.CONSTRAINT_NAME AS FK_NAME, cc.COLUMN_NAME AS FK_COLUMN, cc.POSITION AS KEY_SEQ, "
            + "rc.OWNER AS OTHER_OWNER, rc.TABLE_NAME AS OTHER_TABLE, "
            + "rcc.COLUMN_NAME AS OTHER_COLUMN, c.DELETE_RULE "
            + "FROM ALL_CONSTRAINTS c "
            + "JOIN ALL_CONS_COLUMNS cc ON cc.OWNER = c.OWNER AND cc.CONSTRAINT_NAME = c.CONSTRAINT_NAME "
            + "JOIN ALL_CONSTRAINTS rc ON rc.OWNER = c.R_OWNER AND rc.CONSTRAINT_NAME = c.R_CONSTRAINT_NAME "
            + "JOIN ALL_CONS_COLUMNS rcc ON rcc.OWNER = rc.OWNER AND rcc.CONSTRAINT_NAME = rc.CONSTRAINT_NAME "
            + "  AND rcc.POSITION = cc.POSITION "
            + "WHERE c.OWNER = ? AND c.TABLE_NAME = ? AND c.CONSTRAINT_TYPE = 'R' "
            + "ORDER BY c.CONSTRAINT_NAME, cc.POSITION";
    for (String schema : distinctCases(schemaName)) {
      for (String table : distinctCases(tableName)) {
        try (PreparedStatement statement = connection.prepareStatement(sql)) {
          statement.setString(1, schema);
          statement.setString(2, table);
          try (ResultSet rs = statement.executeQuery()) {
            appendOracleFkRows(rs, foreignKeys, "referencedSchema", "referencedTable", "referencedColumns", "columns");
          }
        }
        if (foreignKeys.size() > 0) {
          return;
        }
      }
    }
  }

  /** Mirror image of {@link #collectTableForeignKeys} — who points *at* this table. */
  @Override
  public void collectTableReferences(
      Connection connection,
      String catalog,
      String schemaName,
      String tableName,
      ArrayNode references)
      throws SQLException {
    // Note the alias assignment here is intentionally the mirror of collectTableForeignKeys':
    // FK_COLUMN/KEY_SEQ must be *this* table's own (referenced) column so appendOracleFkRows'
    // fixed "FK_COLUMN → ownColumnsField" mapping lands it under "columns" — not the referencing
    // child table's column, even though that's what "FK_COLUMN" would suggest.
    String sql =
        "SELECT c.CONSTRAINT_NAME AS FK_NAME, rcc.COLUMN_NAME AS FK_COLUMN, cc.POSITION AS KEY_SEQ, "
            + "c.OWNER AS OTHER_OWNER, c.TABLE_NAME AS OTHER_TABLE, "
            + "cc.COLUMN_NAME AS OTHER_COLUMN, c.DELETE_RULE "
            + "FROM ALL_CONSTRAINTS rc "
            + "JOIN ALL_CONSTRAINTS c ON c.R_OWNER = rc.OWNER AND c.R_CONSTRAINT_NAME = rc.CONSTRAINT_NAME "
            + "  AND c.CONSTRAINT_TYPE = 'R' "
            + "JOIN ALL_CONS_COLUMNS cc ON cc.OWNER = c.OWNER AND cc.CONSTRAINT_NAME = c.CONSTRAINT_NAME "
            + "JOIN ALL_CONS_COLUMNS rcc ON rcc.OWNER = rc.OWNER AND rcc.CONSTRAINT_NAME = rc.CONSTRAINT_NAME "
            + "  AND rcc.POSITION = cc.POSITION "
            + "WHERE rc.OWNER = ? AND rc.TABLE_NAME = ? AND rc.CONSTRAINT_TYPE IN ('P', 'U') "
            + "ORDER BY c.CONSTRAINT_NAME, cc.POSITION";
    for (String schema : distinctCases(schemaName)) {
      for (String table : distinctCases(tableName)) {
        try (PreparedStatement statement = connection.prepareStatement(sql)) {
          statement.setString(1, schema);
          statement.setString(2, table);
          try (ResultSet rs = statement.executeQuery()) {
            appendOracleFkRows(
                rs, references, "referencingSchema", "referencingTable", "referencingColumns", "columns");
          }
        }
        if (references.size() > 0) {
          return;
        }
      }
    }
  }

  private static final class OracleFkBuilder {
    String otherSchema;
    String otherTable;
    String deleteRule;
    final TreeMap<Integer, String> fkColumns = new TreeMap<>();
    final TreeMap<Integer, String> otherColumns = new TreeMap<>();
  }

  /**
   * Groups flat {@code FK_NAME/FK_COLUMN/KEY_SEQ/OTHER_OWNER/OTHER_TABLE/OTHER_COLUMN/
   * DELETE_RULE} rows (shared shape between {@link #collectTableForeignKeys}'s and {@link
   * #collectTableReferences}'s queries) into one JSON object per constraint. The two callers
   * disagree on what the "other side" and "this side" are called in the output, so the field
   * names are parameterized rather than hardcoded.
   */
  private static void appendOracleFkRows(
      ResultSet rs,
      ArrayNode target,
      String otherSchemaField,
      String otherTableField,
      String otherColumnsField,
      String ownColumnsField)
      throws SQLException {
    Map<String, OracleFkBuilder> byName = new LinkedHashMap<>();
    List<String> order = new ArrayList<>();
    while (rs.next()) {
      String fkColumn = rs.getString("FK_COLUMN");
      if (fkColumn == null || fkColumn.isBlank()) {
        continue;
      }
      String name = rs.getString("FK_NAME");
      if (name == null || name.isBlank()) {
        continue;
      }
      OracleFkBuilder builder = byName.get(name);
      if (builder == null) {
        builder = new OracleFkBuilder();
        builder.otherSchema = rs.getString("OTHER_OWNER");
        builder.otherTable = rs.getString("OTHER_TABLE");
        builder.deleteRule = rs.getString("DELETE_RULE");
        byName.put(name, builder);
        order.add(name);
      }
      int keySeq = rs.getInt("KEY_SEQ");
      builder.fkColumns.put(keySeq, fkColumn);
      builder.otherColumns.put(keySeq, rs.getString("OTHER_COLUMN"));
    }
    for (String name : order) {
      OracleFkBuilder builder = byName.get(name);
      ObjectNode node = target.addObject();
      node.put("name", name);
      if (builder.otherSchema != null && !builder.otherSchema.isBlank()) {
        node.put(otherSchemaField, builder.otherSchema);
      }
      node.put(otherTableField, builder.otherTable == null ? "" : builder.otherTable);
      ArrayNode ownColumns = node.putArray(ownColumnsField);
      for (String column : builder.fkColumns.values()) {
        ownColumns.add(column);
      }
      ArrayNode otherColumns = node.putArray(otherColumnsField);
      for (String column : builder.otherColumns.values()) {
        otherColumns.add(column);
      }
      // Oracle has no ON UPDATE action — updateRule is deliberately never emitted.
      if (builder.deleteRule != null && !builder.deleteRule.isBlank()) {
        node.put("deleteRule", builder.deleteRule.trim());
      }
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
        "SELECT cc.CONSTRAINT_NAME AS NAME, c.CONSTRAINT_TYPE AS TYPE, "
            + "cc.COLUMN_NAME AS COLUMN_NAME, NULL AS CHECK_CLAUSE, cc.POSITION AS POS "
            + "FROM ALL_CONSTRAINTS c "
            + "JOIN ALL_CONS_COLUMNS cc "
            + "  ON cc.OWNER = c.OWNER AND cc.CONSTRAINT_NAME = c.CONSTRAINT_NAME "
            + "  AND cc.TABLE_NAME = c.TABLE_NAME "
            + "WHERE c.OWNER = ? AND c.TABLE_NAME = ? AND c.CONSTRAINT_TYPE IN ('P', 'U') "
            + "UNION ALL "
            + "SELECT c.CONSTRAINT_NAME, c.CONSTRAINT_TYPE, NULL, c.SEARCH_CONDITION, 0 "
            + "FROM ALL_CONSTRAINTS c "
            // GENERATED = 'USER NAME' excludes Oracle's implicit NOT NULL checks.
            + "WHERE c.OWNER = ? AND c.TABLE_NAME = ? AND c.CONSTRAINT_TYPE = 'C' "
            + "  AND c.GENERATED = 'USER NAME'";
    for (String schema : distinctCases(schemaName)) {
      for (String table : distinctCases(tableName)) {
        try (PreparedStatement statement = connection.prepareStatement(sql)) {
          statement.setString(1, schema);
          statement.setString(2, table);
          statement.setString(3, schema);
          statement.setString(4, table);
          try (ResultSet rs = statement.executeQuery()) {
            MetadataConstraints.appendFromResultSet(rs, constraints);
          }
        }
        if (constraints.size() > 0) {
          return;
        }
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
        "SELECT TRIGGER_NAME AS NAME, TRIGGERING_EVENT AS EVENT, TRIGGER_TYPE AS TIMING, "
            + "STATUS AS ENABLED "
            + "FROM ALL_TRIGGERS WHERE TABLE_OWNER = ? AND TABLE_NAME = ?";
    for (String schema : distinctCases(schemaName)) {
      for (String table : distinctCases(tableName)) {
        try (PreparedStatement statement = connection.prepareStatement(sql)) {
          statement.setString(1, schema);
          statement.setString(2, table);
          try (ResultSet rs = statement.executeQuery()) {
            MetadataTriggers.appendFromResultSet(rs, triggers);
          }
        }
        if (triggers.size() > 0) {
          return;
        }
      }
    }
  }

  @Override
  public void collectPackageMembers(
      Connection connection,
      String catalog,
      String schemaName,
      String packageName,
      ArrayNode members)
      throws SQLException {
    String[] schemas = distinctCases(schemaName);
    String[] packages = distinctCases(packageName);
    for (String schema : schemas) {
      for (String pkg : packages) {
        appendPackageMembersFromAllProcedures(connection, schema, pkg, members);
        if (members.size() > 0) {
          return;
        }
      }
    }
    // JDBC fallback when ALL_PROCEDURES yields nothing (permissions / older catalogs).
    DatabaseMetaData metadata = connection.getMetaData();
    for (String schema : schemas) {
      for (String pkg : packages) {
        try (ResultSet procedures = metadata.getProcedures(null, schema, "%")) {
          Set<String> seen = new LinkedHashSet<>();
          while (procedures.next()) {
            String procedureCatalog = procedures.getString("PROCEDURE_CAT");
            if (procedureCatalog == null || !procedureCatalog.equalsIgnoreCase(pkg)) {
              continue;
            }
            String name = procedures.getString("PROCEDURE_NAME");
            if (name == null || name.isBlank() || !seen.add(name.toUpperCase(Locale.ROOT))) {
              continue;
            }
            ObjectNode member = members.addObject();
            member.put("name", name);
            member.put("kind", "procedure");
          }
        }
        if (members.size() > 0) {
          return;
        }
      }
    }
  }

  /**
   * Lists package body members via ALL_PROCEDURES; functions are those with a return argument
   * (ALL_ARGUMENTS.POSITION = 0).
   */
  private static void appendPackageMembersFromAllProcedures(
      Connection connection, String schemaName, String packageName, ArrayNode members)
      throws SQLException {
    String sql =
        "SELECT p.PROCEDURE_NAME AS name, "
            + "CASE WHEN EXISTS ("
            + "  SELECT 1 FROM ALL_ARGUMENTS a "
            + "  WHERE a.OWNER = p.OWNER "
            + "    AND a.PACKAGE_NAME = p.OBJECT_NAME "
            + "    AND a.OBJECT_NAME = p.PROCEDURE_NAME "
            + "    AND NVL(a.OVERLOAD, '0') = NVL(p.OVERLOAD, '0') "
            + "    AND a.POSITION = 0"
            + ") THEN 'function' ELSE 'procedure' END AS kind "
            + "FROM ALL_PROCEDURES p "
            + "WHERE p.OWNER = ? "
            + "  AND p.OBJECT_NAME = ? "
            + "  AND p.OBJECT_TYPE = 'PACKAGE' "
            + "  AND p.PROCEDURE_NAME IS NOT NULL "
            + "ORDER BY p.PROCEDURE_NAME, p.OVERLOAD NULLS FIRST";
    Set<String> seen = new LinkedHashSet<>();
    try (PreparedStatement statement = connection.prepareStatement(sql)) {
      statement.setString(1, schemaName);
      statement.setString(2, packageName);
      try (ResultSet rs = statement.executeQuery()) {
        while (rs.next()) {
          String name = rs.getString("name");
          if (name == null || name.isBlank()) {
            continue;
          }
          String key = name.toUpperCase(Locale.ROOT);
          if (!seen.add(key)) {
            continue;
          }
          String kind = rs.getString("kind");
          ObjectNode member = members.addObject();
          member.put("name", name);
          member.put(
              "kind",
              "function".equalsIgnoreCase(kind) ? "function" : "procedure");
        }
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
    String currentSchema =
        MetadataTableScope.querySingleString(
            connection, "SELECT SYS_CONTEXT('USERENV','CURRENT_SCHEMA') FROM DUAL");
    if (currentSchema != null) {
      candidates.add(currentSchema);
    }
    candidates.addAll(MetadataTableScope.sessionSchemaCandidates(connection));
    String user = connection.getMetaData().getUserName();
    if (user != null && !user.isBlank()) {
      candidates.add(user.trim());
    }
    return MetadataTableScope.collectPrimaryKeys(
        connection, schemaName, tableName, keys, candidates, null);
  }

  /**
   * Oracle JDBC often reports materialized views as {@code TABLE}; prefer {@code ALL_OBJECTS}.
   */
  @Override
  public String resolveRelationKind(
      Connection connection, String catalog, String schemaName, String tableName)
      throws SQLException {
    String schema = schemaName == null ? "" : schemaName.trim();
    if (schema.isBlank()) {
      String currentSchema =
          MetadataTableScope.querySingleString(
              connection, "SELECT SYS_CONTEXT('USERENV','CURRENT_SCHEMA') FROM DUAL");
      if (currentSchema != null && !currentSchema.isBlank()) {
        schema = currentSchema.trim();
      } else {
        String user = connection.getMetaData().getUserName();
        if (user != null && !user.isBlank()) {
          schema = user.trim();
        }
      }
    }
    if (schema.isBlank() || tableName == null || tableName.isBlank()) {
      return MetadataRelationKind.resolveViaJdbc(connection, null, schemaName, tableName);
    }

    String sql =
        "SELECT OBJECT_TYPE FROM ALL_OBJECTS WHERE OWNER = ? AND OBJECT_NAME = ? "
            + "AND OBJECT_TYPE IN ('TABLE', 'VIEW', 'MATERIALIZED VIEW')";
    for (String schemaCase : MetadataTableScope.distinctCases(schema)) {
      for (String nameCase : MetadataTableScope.distinctCases(tableName.trim())) {
        try (PreparedStatement statement = connection.prepareStatement(sql)) {
          statement.setString(1, schemaCase);
          statement.setString(2, nameCase);
          try (ResultSet rs = statement.executeQuery()) {
            if (rs.next()) {
              String kind = MetadataRelationKind.fromJdbcTableType(rs.getString(1));
              if (kind != null) {
                return kind;
              }
            }
          }
        }
      }
    }
    return MetadataRelationKind.resolveViaJdbc(connection, null, schemaName, tableName);
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
    if (kind.equals("procedure") || kind.equals("function") || kind.equals("package")) {
      String plsql = fetchOraclePlsqlSource(connection, schemaName, objectName, kind, packageBody);
      if (plsql != null) {
        return plsql;
      }
    }

    String metadataType = MetadataDdl.oracleMetadataType(kind, packageBody);
    try (Statement statement = connection.createStatement()) {
      statement.execute(
          "BEGIN "
              + "DBMS_METADATA.SET_TRANSFORM_PARAM(DBMS_METADATA.SESSION_TRANSFORM,'SQLTERMINATOR',true); "
              + "DBMS_METADATA.SET_TRANSFORM_PARAM(DBMS_METADATA.SESSION_TRANSFORM,'PRETTY',true); "
              + "END;");
    }

    for (String schema : distinctCases(schemaName)) {
      for (String object : distinctCases(objectName)) {
        try (PreparedStatement statement =
            connection.prepareStatement(
                "SELECT DBMS_METADATA.GET_DDL(?, ?, ?) FROM DUAL")) {
          statement.setString(1, metadataType);
          statement.setString(2, object);
          statement.setString(3, schema);
          try (ResultSet rs = statement.executeQuery()) {
            String ddl = MetadataDdl.readFirstColumnAsString(rs);
            if (ddl != null && !ddl.isBlank()) {
              ddl = ddl.trim();
              // A view's DDL text doubles as the editable Save buffer (ViewDdlEditor), but
              // buildPlsqlSaveSql (frontend) now splits a VIEW buffer on statement boundaries
              // and replays each one in order on save — so appending COMMENT ON TABLE/COLUMN
              // here round-trips safely instead of corrupting Save, and as a bonus reapplies the
              // comment on every save, working around Oracle's CREATE OR REPLACE VIEW otherwise
              // silently dropping it. A table's DDL tab has no such Save path (structure edits
              // go through ALTER statements built elsewhere) but gets the same treatment for
              // display consistency.
              if (kind.equals("table") || kind.equals("view")) {
                String comments = fetchOracleCommentDdl(connection, object, schema);
                if (comments != null && !comments.isBlank()) {
                  ddl = ddl + "\n\n" + comments;
                }
              }
              return ddl;
            }
          }
        }
      }
    }
    return null;
  }

  /**
   * {@code DBMS_METADATA.GET_DDL} never includes {@code COMMENT ON TABLE/COLUMN} statements for
   * TABLE/VIEW — unlike {@code CONSTRAINTS}/{@code REF_CONSTRAINTS}, there's no session transform
   * param for comments; they're a separate dependent-object type fetched via
   * {@code GET_DEPENDENT_DDL}.
   *
   * @return {@code null} when the object has no comments at all (ORA-31608, "no object found")
   */
  private String fetchOracleCommentDdl(Connection connection, String objectName, String schemaName)
      throws SQLException {
    try (PreparedStatement statement =
        connection.prepareStatement(
            "SELECT DBMS_METADATA.GET_DEPENDENT_DDL('COMMENT', ?, ?) FROM DUAL")) {
      statement.setString(1, objectName);
      statement.setString(2, schemaName);
      try (ResultSet rs = statement.executeQuery()) {
        String ddl = MetadataDdl.readFirstColumnAsString(rs);
        return ddl == null ? null : ddl.trim();
      }
    } catch (SQLException e) {
      if (e.getErrorCode() == 31608) {
        return null;
      }
      throw e;
    }
  }

  /**
   * Fast path for procedure/function/package source, reading {@code ALL_SOURCE} directly
   * instead of {@code DBMS_METADATA.GET_DDL} — same approach DBeaver uses (see
   * {@code OracleUtils.getSource}/{@code insertCreateReplace} in its source). {@code ALL_SOURCE}
   * is a plain dictionary view of the stored source text with no formatting/transform engine
   * behind it, so it's dramatically faster for large PL/SQL objects: `GET_DDL` was measured at
   * 4+ seconds for one large package in production use, where this is sub-second.
   *
   * {@code ALL_SOURCE.TEXT} does not include the {@code CREATE [OR REPLACE]} prefix — its first
   * row is literally e.g. {@code "PACKAGE BODY name IS\n"} — so that header is reconstructed
   * here to match what {@code DBMS_METADATA.GET_DDL} (and this app's save-SQL builder, which
   * requires a leading {@code CREATE}) already expect. Falls back to {@code null} (letting the
   * caller try {@code DBMS_METADATA.GET_DDL}) on anything unexpected — a custom/wrapped object
   * with no plain-text source, an empty result, or a first line that doesn't parse the way a
   * normal object's does — rather than ever returning something silently wrong.
   */
  private String fetchOraclePlsqlSource(
      Connection connection,
      String schemaName,
      String objectName,
      String kind,
      Boolean packageBody)
      throws SQLException {
    String baseType =
        switch (kind) {
          case "procedure" -> "PROCEDURE";
          case "function" -> "FUNCTION";
          case "package" -> "PACKAGE";
          default -> throw new IllegalArgumentException("Unsupported PL/SQL kind: " + kind);
        };
    String sourceType =
        kind.equals("package") && Boolean.TRUE.equals(packageBody)
            ? baseType + " BODY"
            : baseType;

    for (String schema : distinctCases(schemaName)) {
      for (String object : distinctCases(objectName)) {
        StringBuilder source = new StringBuilder();
        try (PreparedStatement statement =
            connection.prepareStatement(
                "SELECT TEXT FROM ALL_SOURCE WHERE TYPE = ? AND OWNER = ? AND NAME = ? "
                    + "ORDER BY LINE")) {
          statement.setString(1, sourceType);
          statement.setString(2, schema);
          statement.setString(3, object);
          try (ResultSet rs = statement.executeQuery()) {
            while (rs.next()) {
              String line = rs.getString(1);
              source.append(line == null ? "" : line);
            }
          }
        }
        if (source.length() > 0) {
          String withHeader = insertPlsqlCreateReplace(sourceType, schema, source.toString());
          if (withHeader != null) {
            return withHeader;
          }
        }
      }
    }
    return null;
  }

  private static final java.util.regex.Pattern PLSQL_SOURCE_HEADER =
      java.util.regex.Pattern.compile(
          "^\\s*(PROCEDURE|FUNCTION|PACKAGE(?:\\s+BODY)?)\\s+(\"?\\w+\"?)",
          java.util.regex.Pattern.CASE_INSENSITIVE);

  /** {@code ALL_SOURCE.TEXT} has no {@code CREATE [OR REPLACE]} header — reconstruct it. */
  private static String insertPlsqlCreateReplace(String sourceType, String schema, String source) {
    java.util.regex.Matcher matcher = PLSQL_SOURCE_HEADER.matcher(source);
    if (!matcher.find() || matcher.start() != 0) {
      return null;
    }
    return "CREATE OR REPLACE "
        + matcher.group(1).toUpperCase(java.util.Locale.ROOT)
        + " \""
        + schema
        + "\".\""
        + objectNameFromHeader(matcher.group(2))
        + "\""
        + source.substring(matcher.end());
  }

  private static String objectNameFromHeader(String rawName) {
    if (rawName.startsWith("\"") && rawName.endsWith("\"") && rawName.length() >= 2) {
      return rawName.substring(1, rawName.length() - 1);
    }
    return rawName;
  }

  @Override
  public ObjectNode compileObject(
      Connection connection,
      String catalog,
      String schemaName,
      String objectName,
      String kind,
      Boolean packageBody,
      com.fasterxml.jackson.databind.ObjectMapper mapper)
      throws SQLException {
    String normalizedKind = kind.trim().toLowerCase(java.util.Locale.ROOT);
    if (!normalizedKind.equals("procedure")
        && !normalizedKind.equals("function")
        && !normalizedKind.equals("package")
        && !normalizedKind.equals("view")
        && !normalizedKind.equals("trigger")) {
      throw new RuntimeException(
          "Compile is only supported for procedure, function, package, view, and trigger.");
    }

    String alterSql = buildCompileAlterSql(schemaName, objectName, normalizedKind, packageBody);
    try (Statement statement = connection.createStatement()) {
      statement.execute(alterSql);
    } catch (SQLException ignored) {
      // Oracle often surfaces compile failures as warnings/exceptions; ALL_ERRORS is authoritative.
    }

    ArrayNode errors = mapper.createArrayNode();
    List<String> oracleTypes = compileErrorTypes(normalizedKind, packageBody);
    for (String schema : distinctCases(schemaName)) {
      for (String object : distinctCases(objectName)) {
        for (String oracleType : oracleTypes) {
          collectAllErrors(connection, schema, object, oracleType, errors);
        }
        if (errors.size() > 0) {
          break;
        }
      }
      if (errors.size() > 0) {
        break;
      }
    }

    ObjectNode result = mapper.createObjectNode();
    result.put("success", errors.size() == 0);
    result.put("dialectId", id());
    result.set("errors", errors);
    return result;
  }

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
    String normalizedKind = kind.trim().toLowerCase(java.util.Locale.ROOT);
    if (!normalizedKind.equals("table")
        && !normalizedKind.equals("view")
        && !normalizedKind.equals("procedure")
        && !normalizedKind.equals("function")
        && !normalizedKind.equals("package")) {
      throw new RuntimeException(
          "Dependencies are only supported for table, view, procedure, function, and package.");
    }

    java.util.List<String> oracleTypes =
        MetadataDdl.oracleDependencyTypes(normalizedKind, packageBody);
  outer:
    for (String schema : distinctCases(schemaName)) {
      for (String object : distinctCases(objectName)) {
        collectAllDependencies(connection, schema, object, oracleTypes, dependencies);
        if (dependencies.size() > 0) {
          break outer;
        }
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
    String normalizedKind = kind.trim().toLowerCase(java.util.Locale.ROOT);
    if (!normalizedKind.equals("table")
        && !normalizedKind.equals("view")
        && !normalizedKind.equals("procedure")
        && !normalizedKind.equals("function")
        && !normalizedKind.equals("package")) {
      throw new RuntimeException(
          "Dependents are only supported for table, view, procedure, function, and package.");
    }

    java.util.List<String> oracleTypes =
        MetadataDdl.oracleDependencyTypes(normalizedKind, packageBody);
  outer:
    for (String schema : distinctCases(schemaName)) {
      for (String object : distinctCases(objectName)) {
        collectAllDependents(connection, schema, object, oracleTypes, dependents);
        if (dependents.size() > 0) {
          break outer;
        }
      }
    }
  }

  private static void collectAllDependents(
      Connection connection,
      String schema,
      String object,
      java.util.List<String> oracleTypes,
      ArrayNode dependents)
      throws SQLException {
    String placeholders =
        String.join(", ", java.util.Collections.nCopies(oracleTypes.size(), "?"));
    String sql =
        "SELECT DISTINCT OWNER, NAME, TYPE, DEPENDENCY_TYPE "
            + "FROM ALL_DEPENDENCIES "
            + "WHERE REFERENCED_OWNER = ? AND REFERENCED_NAME = ? AND REFERENCED_TYPE IN ("
            + placeholders
            + ") "
            + "ORDER BY TYPE, OWNER, NAME";
    try (PreparedStatement statement = connection.prepareStatement(sql)) {
      int index = 1;
      statement.setString(index++, schema);
      statement.setString(index++, object);
      for (String oracleType : oracleTypes) {
        statement.setString(index++, oracleType);
      }
      try (ResultSet rs = statement.executeQuery()) {
        while (rs.next()) {
          String owner = rs.getString("OWNER");
          String name = rs.getString("NAME");
          String type = rs.getString("TYPE");
          if (owner == null || owner.isBlank() || name == null || name.isBlank()
              || type == null || type.isBlank()) {
            continue;
          }
          ObjectNode entry = dependents.addObject();
          entry.put("schema", owner.trim());
          entry.put("name", name.trim());
          entry.put("type", type.trim());
          String dependencyType = rs.getString("DEPENDENCY_TYPE");
          if (dependencyType != null && !dependencyType.isBlank()) {
            entry.put("dependencyType", dependencyType.trim());
          }
        }
      }
    }
  }

  private static void collectAllDependencies(
      Connection connection,
      String schema,
      String object,
      java.util.List<String> oracleTypes,
      ArrayNode dependencies)
      throws SQLException {
    String placeholders =
        String.join(", ", java.util.Collections.nCopies(oracleTypes.size(), "?"));
    String sql =
        "SELECT DISTINCT REFERENCED_OWNER, REFERENCED_NAME, REFERENCED_TYPE, DEPENDENCY_TYPE "
            + "FROM ALL_DEPENDENCIES "
            + "WHERE OWNER = ? AND NAME = ? AND TYPE IN ("
            + placeholders
            + ") "
            + "ORDER BY REFERENCED_TYPE, REFERENCED_OWNER, REFERENCED_NAME";
    try (PreparedStatement statement = connection.prepareStatement(sql)) {
      int index = 1;
      statement.setString(index++, schema);
      statement.setString(index++, object);
      for (String oracleType : oracleTypes) {
        statement.setString(index++, oracleType);
      }
      try (ResultSet rs = statement.executeQuery()) {
        while (rs.next()) {
          String referencedOwner = rs.getString("REFERENCED_OWNER");
          String referencedName = rs.getString("REFERENCED_NAME");
          String referencedType = rs.getString("REFERENCED_TYPE");
          if (referencedOwner == null
              || referencedOwner.isBlank()
              || referencedName == null
              || referencedName.isBlank()
              || referencedType == null
              || referencedType.isBlank()) {
            continue;
          }
          ObjectNode entry = dependencies.addObject();
          entry.put("schema", referencedOwner.trim());
          entry.put("name", referencedName.trim());
          entry.put("type", referencedType.trim());
          String dependencyType = rs.getString("DEPENDENCY_TYPE");
          if (dependencyType != null && !dependencyType.isBlank()) {
            entry.put("dependencyType", dependencyType.trim());
          }
        }
      }
    }
  }

  private static String buildCompileAlterSql(
      String schemaName, String objectName, String kind, Boolean packageBody) {
    String qualified = quoteOracleIdent(schemaName) + "." + quoteOracleIdent(objectName);
    return switch (kind) {
      case "procedure" -> "ALTER PROCEDURE " + qualified + " COMPILE";
      case "function" -> "ALTER FUNCTION " + qualified + " COMPILE";
      case "package" -> {
        if (packageBody == null) {
          yield "ALTER PACKAGE " + qualified + " COMPILE";
        }
        if (packageBody) {
          yield "ALTER PACKAGE " + qualified + " COMPILE BODY";
        }
        yield "ALTER PACKAGE " + qualified + " COMPILE PACKAGE";
      }
      case "view" -> "ALTER VIEW " + qualified + " COMPILE";
      case "trigger" -> "ALTER TRIGGER " + qualified + " COMPILE";
      default -> throw new IllegalArgumentException("Unsupported compile kind: " + kind);
    };
  }

  private static List<String> compileErrorTypes(String kind, Boolean packageBody) {
    return switch (kind) {
      case "procedure" -> List.of("PROCEDURE");
      case "function" -> List.of("FUNCTION");
      case "package" -> {
        if (packageBody == null) {
          yield List.of("PACKAGE", "PACKAGE BODY");
        }
        yield packageBody ? List.of("PACKAGE BODY") : List.of("PACKAGE");
      }
      case "view" -> List.of("VIEW");
      case "trigger" -> List.of("TRIGGER");
      default -> List.of();
    };
  }

  private static void collectAllErrors(
      Connection connection,
      String schema,
      String object,
      String oracleType,
      ArrayNode errors)
      throws SQLException {
    String sql =
        "SELECT SEQUENCE, LINE, POSITION, TEXT, TYPE, ATTRIBUTE "
            + "FROM ALL_ERRORS "
            + "WHERE OWNER = ? AND NAME = ? AND TYPE = ? "
            + "ORDER BY SEQUENCE, LINE, POSITION";
    try (PreparedStatement statement = connection.prepareStatement(sql)) {
      statement.setString(1, schema);
      statement.setString(2, object);
      statement.setString(3, oracleType);
      try (ResultSet rs = statement.executeQuery()) {
        while (rs.next()) {
          ObjectNode entry = errors.addObject();
          entry.put("sequence", rs.getInt("SEQUENCE"));
          int line = rs.getInt("LINE");
          entry.put("line", line <= 0 ? 1 : line);
          int position = rs.getInt("POSITION");
          entry.put("column", position <= 0 ? 1 : position);
          String text = rs.getString("TEXT");
          entry.put("message", text == null ? "" : text.trim());
          String type = rs.getString("TYPE");
          if (type != null && !type.isBlank()) {
            entry.put("type", type.trim());
          }
          String attribute = rs.getString("ATTRIBUTE");
          if (attribute != null && !attribute.isBlank()) {
            entry.put("attribute", attribute.trim());
          }
        }
      }
    }
  }

  private static String quoteOracleIdent(String value) {
    return "\"" + value.replace("\"", "\"\"") + "\"";
  }

  @Override
  public String quoteIdentifier(String raw) {
    return quoteOracleIdent(raw);
  }

  /** OFFSET/FETCH NEXT (12c+) — no ORDER BY requirement, so it's simply omitted when absent. */
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
    sql.append(" OFFSET ").append(offset).append(" ROWS FETCH NEXT ").append(limit)
        .append(" ROWS ONLY");
    return sql.toString();
  }

  private static String[] distinctCases(String value) {
    String upper = value.toUpperCase(java.util.Locale.ROOT);
    if (value.equals(upper)) {
      return new String[] {value};
    }
    return new String[] {value, upper};
  }

  @Override
  public void collectSchemaObjects(
      Connection connection,
      String catalog,
      String schemaName,
      boolean includeSecondaryKinds,
      ArrayNode objects)
      throws SQLException {
    DatabaseMetaData metadata = connection.getMetaData();

    try (ResultSet tables =
        metadata.getTables(null, schemaName, "%", new String[] {"TABLE", "VIEW"})) {
      while (tables.next()) {
        String name = tables.getString("TABLE_NAME");
        String type = tables.getString("TABLE_TYPE");
        if (name == null || name.isBlank()) {
          continue;
        }
        ObjectNode object = objects.addObject();
        object.put("name", name);
        object.put(
            "kind",
            type != null && type.toUpperCase(java.util.Locale.ROOT).contains("VIEW")
                ? "view"
                : "table");
      }
    }

    Set<String> packageNames = new LinkedHashSet<>();
    Map<String, String> standaloneRoutineTypes = listStandaloneRoutineTypes(connection, schemaName);
    try (ResultSet procedures = metadata.getProcedures(null, schemaName, "%")) {
      while (procedures.next()) {
        String name = procedures.getString("PROCEDURE_NAME");
        if (name == null || name.isBlank()) {
          continue;
        }
        // Oracle Specific: the driver returns the package name via PROCEDURE_CAT
        // (its "catalog" column doubles as package name) for members of a PACKAGE
        // body; PROCEDURE_NAME is just the member name with no dot notation.
        String packageName = procedures.getString("PROCEDURE_CAT");
        if (packageName != null && !packageName.isBlank()) {
          packageNames.add(packageName);
          continue;
        }
        // PROCEDURE_TYPE from the driver is unreliable for Oracle (often reports
        // "result unknown"), so classify function vs. procedure using ALL_OBJECTS
        // instead, which reports the real object type.
        String objectType = standaloneRoutineTypes.get(name);
        ObjectNode object = objects.addObject();
        object.put("name", name);
        object.put(
            "kind", "FUNCTION".equalsIgnoreCase(objectType) ? "function" : "procedure");
      }
    }

    for (String packageName : listPackageNames(connection, schemaName, packageNames)) {
      ObjectNode object = objects.addObject();
      object.put("name", packageName);
      object.put("kind", "package");
    }

    if (!includeSecondaryKinds) {
      return;
    }

    appendSimpleObjects(
        connection,
        "SELECT INDEX_NAME AS NAME FROM ALL_INDEXES WHERE OWNER = ?",
        schemaName,
        "index",
        objects);
    appendSimpleObjects(
        connection,
        "SELECT SEQUENCE_NAME AS NAME FROM ALL_SEQUENCES WHERE SEQUENCE_OWNER = ?",
        schemaName,
        "sequence",
        objects);
    appendSimpleObjects(
        connection,
        "SELECT SYNONYM_NAME AS NAME FROM ALL_SYNONYMS WHERE OWNER = ?",
        schemaName,
        "synonym",
        objects);
    appendSimpleObjects(
        connection,
        "SELECT TRIGGER_NAME AS NAME FROM ALL_TRIGGERS WHERE OWNER = ?",
        schemaName,
        "trigger",
        objects);
    appendSimpleObjects(
        connection,
        "SELECT TYPE_NAME AS NAME FROM ALL_TYPES WHERE OWNER = ?",
        schemaName,
        "type",
        objects);
  }

  /**
   * {@code ALL_OBJECTS.OBJECT_TYPE} values this dialect surfaces via {@link #findObjectsByName}
   * — deliberately excludes {@code PACKAGE BODY}/{@code TYPE BODY} (the header row already
   * represents the package/type) and every other Oracle object type this app has no use for.
   */
  private static final String FIND_OBJECTS_TYPE_LIST =
      "'TABLE', 'VIEW', 'PROCEDURE', 'FUNCTION', 'PACKAGE', 'TRIGGER', 'INDEX', 'SEQUENCE', "
          + "'SYNONYM', 'TYPE'";

  @Override
  public void findObjectsByName(
      Connection connection, String catalog, String name, boolean contains, ArrayNode objects)
      throws SQLException {
    // ALL_OBJECTS already spans every kind we search (unlike the other three dialects, which
    // need a second query for non-table/view kinds) — one query, comment matching folded in via
    // a LEFT JOIN restricted to TABLE/VIEW rows.
    String namePredicate =
        contains ? "UPPER(o.OBJECT_NAME) LIKE UPPER(?) ESCAPE '\\'" : "o.OBJECT_NAME = ?";
    StringBuilder sql =
        new StringBuilder(
            "SELECT o.OWNER, o.OBJECT_NAME, o.OBJECT_TYPE, tc.COMMENTS AS TABLE_COMMENT "
                + "FROM ALL_OBJECTS o "
                + "LEFT JOIN ALL_TAB_COMMENTS tc "
                + "  ON tc.OWNER = o.OWNER AND tc.TABLE_NAME = o.OBJECT_NAME "
                + "  AND o.OBJECT_TYPE IN ('TABLE', 'VIEW') "
                + "WHERE o.OBJECT_TYPE IN ("
                + FIND_OBJECTS_TYPE_LIST
                + ") AND ("
                + namePredicate);
    // Comment matching is substring-only (an exact-equality match against free-text comments is
    // never useful) and table/view-only (procedures/etc. don't carry a comparable comment here).
    if (contains) {
      sql.append(
          " OR (o.OBJECT_TYPE IN ('TABLE', 'VIEW') AND ("
              + "UPPER(tc.COMMENTS) LIKE UPPER(?) ESCAPE '\\' "
              + "OR EXISTS (SELECT 1 FROM ALL_COL_COMMENTS cc "
              + "WHERE cc.OWNER = o.OWNER AND cc.TABLE_NAME = o.OBJECT_NAME "
              + "AND UPPER(cc.COMMENTS) LIKE UPPER(?) ESCAPE '\\')))");
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
          object.put("schemaName", rs.getString("OWNER"));
          object.put("name", rs.getString("OBJECT_NAME"));
          object.put("kind", oracleFindObjectsKind(rs.getString("OBJECT_TYPE")));
          String tableComment = rs.getString("TABLE_COMMENT");
          if (tableComment != null && !tableComment.isBlank()) {
            object.put("commentSnippet", tableComment);
          }
        }
      }
    }
  }

  private static String oracleFindObjectsKind(String objectType) {
    if (objectType == null) return "table";
    return switch (objectType) {
      case "VIEW" -> "view";
      case "PROCEDURE" -> "procedure";
      case "FUNCTION" -> "function";
      case "PACKAGE" -> "package";
      case "TRIGGER" -> "trigger";
      case "INDEX" -> "index";
      case "SEQUENCE" -> "sequence";
      case "SYNONYM" -> "synonym";
      case "TYPE" -> "type";
      default -> "table";
    };
  }

  /** Runs a single-column {@code (name) WHERE owner/schema = ?} query and appends {@code kind} objects. */
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

  /**
   * Looks up ALL_OBJECTS.OBJECT_TYPE for standalone (non-packaged) PROCEDURE/FUNCTION
   * objects so callers can classify getProcedures() rows accurately; Oracle's
   * PROCEDURE_TYPE metadata column is not reliable for this.
   */
  private Map<String, String> listStandaloneRoutineTypes(Connection connection, String schemaName)
      throws SQLException {
    Map<String, String> types = new LinkedHashMap<>();
    String sql =
        "SELECT OBJECT_NAME, OBJECT_TYPE FROM ALL_OBJECTS "
            + "WHERE OWNER = ? AND OBJECT_TYPE IN ('PROCEDURE', 'FUNCTION')";
    try (PreparedStatement statement = connection.prepareStatement(sql)) {
      statement.setString(1, schemaName);
      try (ResultSet rs = statement.executeQuery()) {
        while (rs.next()) {
          String name = rs.getString("OBJECT_NAME");
          String type = rs.getString("OBJECT_TYPE");
          if (name != null && !name.isBlank()) {
            types.put(name, type);
          }
        }
      }
    }
    return types;
  }

  /**
   * Merges package names discovered via {@code getProcedures} with a direct
   * {@code ALL_OBJECTS} lookup so that packages with no visible members (e.g. spec-only
   * packages with just constants/types) are still listed.
   */
  private Set<String> listPackageNames(
      Connection connection, String schemaName, Set<String> discovered) throws SQLException {
    Set<String> names = new TreeSet<>(discovered);
    String sql = "SELECT OBJECT_NAME FROM ALL_OBJECTS WHERE OWNER = ? AND OBJECT_TYPE = 'PACKAGE'";
    try (PreparedStatement statement = connection.prepareStatement(sql)) {
      statement.setString(1, schemaName);
      try (ResultSet rs = statement.executeQuery()) {
        while (rs.next()) {
          String name = rs.getString("OBJECT_NAME");
          if (name != null && !name.isBlank()) {
            names.add(name);
          }
        }
      }
    }
    return names;
  }
}
