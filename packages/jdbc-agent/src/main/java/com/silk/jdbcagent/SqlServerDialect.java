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
import java.util.regex.Matcher;
import java.util.regex.Pattern;

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
  public List<String> listSchemaNames(Connection connection, String catalog) throws SQLException {
    if (catalog != null && !catalog.isBlank()) {
      // mssql-jdbc's getSchemas(catalog, ...) empirically returns nothing for a catalog other
      // than the connection's current one (contrary to the JDBC contract) — query sys.schemas
      // directly via a 3-part reference instead, which works regardless of session catalog.
      return listSchemaNamesInCatalog(connection, catalog);
    }

    Set<String> names = new LinkedHashSet<>();
    try (ResultSet schemas = connection.getMetaData().getSchemas(null, null)) {
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

  private static List<String> listSchemaNamesInCatalog(Connection connection, String catalog)
      throws SQLException {
    String prefix = CatalogQualifier.prefix(catalog);
    Set<String> names = new LinkedHashSet<>();
    try (Statement statement = connection.createStatement();
        ResultSet rs = statement.executeQuery("SELECT name AS NAME FROM " + prefix + "sys.schemas ORDER BY name")) {
      while (rs.next()) {
        String name = rs.getString("NAME");
        if (name != null && !name.isBlank()) {
          names.add(name);
        }
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
    if (catalog != null && !catalog.isBlank()) {
      // Same reasoning as listSchemaNamesInCatalog — getTables/getProcedures/getFunctions
      // don't reliably see another catalog's objects, so query sys.objects directly.
      collectSchemaObjectsInCatalog(connection, catalog, schemaName, objects);
    } else {
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
              "kind", type != null && type.toUpperCase(Locale.ROOT).contains("VIEW") ? "view" : "table");
        }
      }

      try (ResultSet procedures = metadata.getProcedures(null, schemaName, "%")) {
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
      try (ResultSet functions = metadata.getFunctions(null, schemaName, "%")) {
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
    }

    // SQL Server has no PACKAGE concept; nothing to add for the "package" kind.

    if (!includeSecondaryKinds) {
      return;
    }

    String prefix = CatalogQualifier.prefix(catalog);
    appendSimpleObjects(
        connection,
        "SELECT DISTINCT i.name AS NAME FROM " + prefix + "sys.indexes i "
            + "JOIN " + prefix + "sys.objects o ON o.object_id = i.object_id "
            + "JOIN " + prefix + "sys.schemas s ON s.schema_id = o.schema_id "
            + "WHERE s.name = ? AND i.name IS NOT NULL AND o.is_ms_shipped = 0",
        schemaName,
        "index",
        objects);
    appendSimpleObjects(
        connection,
        "SELECT sq.name AS NAME FROM " + prefix + "sys.sequences sq "
            + "JOIN " + prefix + "sys.schemas s ON s.schema_id = sq.schema_id "
            + "WHERE s.name = ?",
        schemaName,
        "sequence",
        objects);
    appendSimpleObjects(
        connection,
        "SELECT syn.name AS NAME FROM " + prefix + "sys.synonyms syn "
            + "JOIN " + prefix + "sys.schemas s ON s.schema_id = syn.schema_id "
            + "WHERE s.name = ?",
        schemaName,
        "synonym",
        objects);
    appendSimpleObjects(
        connection,
        "SELECT tr.name AS NAME FROM " + prefix + "sys.triggers tr "
            + "JOIN " + prefix + "sys.objects o ON o.object_id = tr.parent_id "
            + "JOIN " + prefix + "sys.schemas s ON s.schema_id = o.schema_id "
            + "WHERE s.name = ? AND tr.parent_class = 1",
        schemaName,
        "trigger",
        objects);
    appendSimpleObjects(
        connection,
        "SELECT t.name AS NAME FROM " + prefix + "sys.types t "
            + "JOIN " + prefix + "sys.schemas s ON s.schema_id = t.schema_id "
            + "WHERE s.name = ? AND t.is_user_defined = 1",
        schemaName,
        "type",
        objects);
  }

  /**
   * Tables/views/procedures/functions for a non-current catalog, queried directly against
   * {@code sys.objects} rather than {@code DatabaseMetaData.getTables/getProcedures/getFunctions}
   * — see the comment in {@link #collectSchemaObjects}.
   */
  private static void collectSchemaObjectsInCatalog(
      Connection connection, String catalog, String schemaName, ArrayNode objects)
      throws SQLException {
    String prefix = CatalogQualifier.prefix(catalog);
    String sql =
        "SELECT o.name AS NAME, o.type AS OBJ_TYPE "
            + "FROM " + prefix + "sys.objects o "
            + "JOIN " + prefix + "sys.schemas s ON s.schema_id = o.schema_id "
            + "WHERE s.name = ? AND o.type IN ('U', 'V', 'P', 'FN', 'IF', 'TF') "
            + "ORDER BY o.name";
    try (PreparedStatement statement = connection.prepareStatement(sql)) {
      statement.setString(1, schemaName);
      try (ResultSet rs = statement.executeQuery()) {
        while (rs.next()) {
          String name = rs.getString("NAME");
          String objType = rs.getString("OBJ_TYPE");
          if (name == null || name.isBlank() || objType == null) {
            continue;
          }
          String kind =
              switch (objType.trim()) {
                case "U" -> "table";
                case "V" -> "view";
                case "P" -> "procedure";
                case "FN", "IF", "TF" -> "function";
                default -> null;
              };
          if (kind == null) {
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
   * {@code sys.objects.type} values folded into the single {@link #findObjectsByName} query —
   * table/view/procedure/function/trigger/synonym are all rows in {@code sys.objects} itself,
   * unlike index/sequence/type (separate catalog views, queried on top in
   * {@link #findOtherKindsByName}).
   */
  private static final String FIND_OBJECTS_TYPE_LIST =
      "'U', 'V', 'P', 'FN', 'IF', 'TF', 'TR', 'SN'";

  @Override
  public void findObjectsByName(
      Connection connection, String catalog, String name, boolean contains, ArrayNode objects)
      throws SQLException {
    // Only ever looks at the one `catalog` given (or the connection's current database when
    // blank) — the AI tool's caller loops listCatalogNames() itself to cover every database.
    String prefix = CatalogQualifier.prefix(catalog);
    // SQL Server's default instance collation is usually case-insensitive already, but a target
    // instance could be configured with a case-sensitive collation — wrap both sides in UPPER()
    // to be explicit, consistent with the other three dialects.
    String namePredicate = contains ? "UPPER(o.name) LIKE UPPER(?) ESCAPE '\\'" : "o.name = ?";
    StringBuilder sql =
        new StringBuilder(
            "SELECT s.name AS SCHEMA_NAME, o.name AS OBJECT_NAME, o.type AS OBJ_TYPE, "
                + "CAST(ep.value AS NVARCHAR(MAX)) AS TABLE_COMMENT "
                + "FROM " + prefix + "sys.objects o "
                + "JOIN " + prefix + "sys.schemas s ON s.schema_id = o.schema_id "
                + "LEFT JOIN " + prefix + "sys.extended_properties ep "
                + "  ON ep.major_id = o.object_id AND ep.minor_id = 0 "
                + "  AND ep.name = 'MS_Description' AND o.type IN ('U', 'V') "
                + "WHERE o.type IN (" + FIND_OBJECTS_TYPE_LIST + ") AND ("
                + namePredicate);
    // Comment matching is substring-only and table/view-only, same reasoning as every other
    // dialect — see DbDialect#findObjectsByName's doc comment.
    if (contains) {
      sql.append(
          " OR (o.type IN ('U', 'V') AND ("
              + "UPPER(ep.value) LIKE UPPER(?) ESCAPE '\\' "
              + "OR EXISTS (SELECT 1 FROM " + prefix + "sys.extended_properties cep "
              + "WHERE cep.major_id = o.object_id AND cep.minor_id > 0 "
              + "AND cep.name = 'MS_Description' "
              + "AND UPPER(CAST(cep.value AS NVARCHAR(MAX))) LIKE UPPER(?) ESCAPE '\\')))");
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
          object.put("kind", sqlServerFindObjectsKind(rs.getString("OBJ_TYPE")));
          String tableComment = rs.getString("TABLE_COMMENT");
          if (tableComment != null && !tableComment.isBlank()) {
            object.put("commentSnippet", tableComment);
          }
        }
      }
    }
    findOtherKindsByName(connection, prefix, name, contains, objects);
  }

  private static String sqlServerFindObjectsKind(String objType) {
    if (objType == null) return "table";
    return switch (objType.trim()) {
      case "V" -> "view";
      case "P" -> "procedure";
      case "FN", "IF", "TF" -> "function";
      case "TR" -> "trigger";
      case "SN" -> "synonym";
      default -> "table";
    };
  }

  /**
   * Indexes/sequences/types matching {@code name} (no schema predicate — every schema in
   * {@code catalog} is searched) — the {@code sys.objects} kinds not covered above.
   */
  private static void findOtherKindsByName(
      Connection connection, String prefix, String name, boolean contains, ArrayNode objects)
      throws SQLException {
    String pattern = contains ? LikeEscape.containsPattern(name) : name;
    appendNameFilteredObjects(
        connection,
        "SELECT s.name AS SCHEMA_NAME, i.name AS NAME FROM " + prefix + "sys.indexes i "
            + "JOIN " + prefix + "sys.objects o ON o.object_id = i.object_id "
            + "JOIN " + prefix + "sys.schemas s ON s.schema_id = o.schema_id "
            + "WHERE i.name IS NOT NULL AND o.is_ms_shipped = 0 AND "
            + (contains ? "UPPER(i.name) LIKE UPPER(?) ESCAPE '\\'" : "i.name = ?"),
        pattern,
        "index",
        objects);
    appendNameFilteredObjects(
        connection,
        "SELECT s.name AS SCHEMA_NAME, sq.name AS NAME FROM " + prefix + "sys.sequences sq "
            + "JOIN " + prefix + "sys.schemas s ON s.schema_id = sq.schema_id "
            + "WHERE "
            + (contains ? "UPPER(sq.name) LIKE UPPER(?) ESCAPE '\\'" : "sq.name = ?"),
        pattern,
        "sequence",
        objects);
    appendNameFilteredObjects(
        connection,
        "SELECT s.name AS SCHEMA_NAME, t.name AS NAME FROM " + prefix + "sys.types t "
            + "JOIN " + prefix + "sys.schemas s ON s.schema_id = t.schema_id "
            + "WHERE t.is_user_defined = 1 AND "
            + (contains ? "UPPER(t.name) LIKE UPPER(?) ESCAPE '\\'" : "t.name = ?"),
        pattern,
        "type",
        objects);
  }

  /** Runs a {@code (SCHEMA_NAME, NAME) WHERE ...predicate on NAME} query and appends {@code kind} objects. */
  private static void appendNameFilteredObjects(
      Connection connection, String sql, String pattern, String kind, ArrayNode objects)
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
    if (catalog != null && !catalog.isBlank()) {
      collectTableColumnsInCatalog(connection, catalog, schemaName, tableName, columns);
    } else {
      DatabaseMetaData metadata = connection.getMetaData();
      try (ResultSet rs = metadata.getColumns(null, schemaName, tableName, "%")) {
        MetadataColumns.appendFromResultSet(rs, columns);
      }
    }
    applyColumnComments(connection, catalog, schemaName, tableName, columns);
    applyColumnDefaultConstraintNames(connection, catalog, schemaName, tableName, columns);
  }

  private static void collectTableColumnsInCatalog(
      Connection connection,
      String catalog,
      String schemaName,
      String tableName,
      ArrayNode columns)
      throws SQLException {
    String prefix = CatalogQualifier.prefix(catalog);
    String sql =
        "SELECT c.COLUMN_NAME AS COLUMN_NAME, c.DATA_TYPE AS TYPE_NAME, "
            + "COALESCE(c.CHARACTER_MAXIMUM_LENGTH, c.NUMERIC_PRECISION, c.DATETIME_PRECISION) AS COLUMN_SIZE, "
            + "c.NUMERIC_SCALE AS DECIMAL_DIGITS, "
            + "CASE WHEN c.IS_NULLABLE = 'YES' THEN 1 ELSE 0 END AS NULLABLE, "
            + "c.COLUMN_DEFAULT AS COLUMN_DEF, "
            + "CAST(NULL AS NVARCHAR(4000)) AS REMARKS, "
            + "c.ORDINAL_POSITION AS ORDINAL_POSITION, "
            + "CASE WHEN sc.is_identity = 1 THEN 'YES' ELSE 'NO' END AS IS_AUTOINCREMENT, "
            + "CASE WHEN sc.is_computed = 1 THEN 'YES' ELSE 'NO' END AS IS_GENERATEDCOLUMN "
            + "FROM " + prefix + "INFORMATION_SCHEMA.COLUMNS c "
            + "LEFT JOIN " + prefix + "sys.objects o ON o.name = c.TABLE_NAME "
            + "LEFT JOIN " + prefix + "sys.schemas s ON s.schema_id = o.schema_id AND s.name = c.TABLE_SCHEMA "
            + "LEFT JOIN " + prefix + "sys.columns sc ON sc.object_id = o.object_id AND sc.name = c.COLUMN_NAME "
            + "WHERE c.TABLE_SCHEMA = ? AND c.TABLE_NAME = ? "
            + "ORDER BY c.ORDINAL_POSITION";
    try (PreparedStatement statement = connection.prepareStatement(sql)) {
      statement.setString(1, schemaName);
      statement.setString(2, tableName);
      try (ResultSet rs = statement.executeQuery()) {
        MetadataColumns.appendFromResultSet(rs, columns);
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
    if (catalog != null && !catalog.isBlank()) {
      collectRoutineArgumentsInCatalog(connection, catalog, schemaName, routineName, arguments);
      return;
    }
    DatabaseMetaData metadata = connection.getMetaData();
    boolean isFunction = "function".equals(kind);
    try (ResultSet rs =
        isFunction
            ? metadata.getFunctionColumns(null, schemaName, routineName, "%")
            : metadata.getProcedureColumns(null, schemaName, routineName, "%")) {
      MetadataArguments.appendFromResultSet(rs, kind, arguments);
    }
  }

  /**
   * {@code sys.parameters} has no JDBC-style {@code COLUMN_TYPE} constant — T-SQL only
   * distinguishes IN from OUTPUT ({@code is_output}); {@code parameter_id = 0} is the
   * routine's return-value slot (a function's return type, or a procedure's implicit int
   * return code). Direction is derived directly here rather than routed through
   * {@link MetadataArguments}, which expects real JDBC {@code COLUMN_TYPE} values.
   */
  private static void collectRoutineArgumentsInCatalog(
      Connection connection,
      String catalog,
      String schemaName,
      String routineName,
      ArrayNode arguments)
      throws SQLException {
    String prefix = CatalogQualifier.prefix(catalog);
    String sql =
        "SELECT p.name AS COLUMN_NAME, t.name AS TYPE_NAME, p.is_output AS IS_OUTPUT, "
            + "p.parameter_id AS ORDINAL_POSITION "
            + "FROM " + prefix + "sys.parameters p "
            + "JOIN " + prefix + "sys.objects o ON o.object_id = p.object_id "
            + "JOIN " + prefix + "sys.schemas s ON s.schema_id = o.schema_id "
            + "JOIN " + prefix + "sys.types t ON t.user_type_id = p.user_type_id "
            + "WHERE s.name = ? AND o.name = ? "
            + "ORDER BY p.parameter_id";
    try (PreparedStatement statement = connection.prepareStatement(sql)) {
      statement.setString(1, schemaName);
      statement.setString(2, routineName);
      try (ResultSet rs = statement.executeQuery()) {
        while (rs.next()) {
          int ordinal = rs.getInt("ORDINAL_POSITION");
          ObjectNode argument = arguments.addObject();
          String name = rs.getString("COLUMN_NAME");
          if (name != null && !name.isBlank()) {
            argument.put("name", name);
          }
          String typeName = rs.getString("TYPE_NAME");
          if (typeName != null && !typeName.isBlank()) {
            argument.put("typeName", typeName);
          }
          argument.put(
              "direction", ordinal == 0 ? "return" : (rs.getBoolean("IS_OUTPUT") ? "out" : "in"));
          argument.put("position", ordinal);
        }
      }
    }
  }

  @Override
  public void collectTableIndexes(
      Connection connection,
      String catalog,
      String schemaName,
      String tableName,
      ArrayNode indexes)
      throws SQLException {
    if (catalog != null && !catalog.isBlank()) {
      collectTableIndexesInCatalog(connection, catalog, schemaName, tableName, indexes);
      return;
    }
    DatabaseMetaData metadata = connection.getMetaData();
    try (ResultSet rs = metadata.getIndexInfo(null, schemaName, tableName, false, true)) {
      MetadataIndexes.appendFromResultSet(rs, indexes);
    }
  }

  private static void collectTableIndexesInCatalog(
      Connection connection,
      String catalog,
      String schemaName,
      String tableName,
      ArrayNode indexes)
      throws SQLException {
    String prefix = CatalogQualifier.prefix(catalog);
    String sql =
        "SELECT 1 AS TYPE, i.name AS INDEX_NAME, c.name AS COLUMN_NAME, "
            + "CASE WHEN i.is_unique = 1 THEN 0 ELSE 1 END AS NON_UNIQUE, "
            + "ic.key_ordinal AS ORDINAL_POSITION "
            + "FROM " + prefix + "sys.indexes i "
            + "JOIN " + prefix + "sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id "
            + "JOIN " + prefix + "sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id "
            + "JOIN " + prefix + "sys.objects o ON o.object_id = i.object_id "
            + "JOIN " + prefix + "sys.schemas s ON s.schema_id = o.schema_id "
            + "WHERE s.name = ? AND o.name = ? AND i.name IS NOT NULL AND ic.is_included_column = 0 "
            + "ORDER BY i.name, ic.key_ordinal";
    try (PreparedStatement statement = connection.prepareStatement(sql)) {
      statement.setString(1, schemaName);
      statement.setString(2, tableName);
      try (ResultSet rs = statement.executeQuery()) {
        MetadataIndexes.appendFromResultSet(rs, indexes);
      }
    }
  }

  /**
   * Translates {@code sys.foreign_keys}' referential-action codes (0=NO_ACTION, 1=CASCADE,
   * 2=SET_NULL, 3=SET_DEFAULT) to the {@link DatabaseMetaData} constants that {@link
   * MetadataForeignKeys}/{@link MetadataReferences} expect (importedKeyCascade=0,
   * importedKeySetNull=2, importedKeyNoAction=3, importedKeySetDefault=4) — the two numbering
   * schemes don't match, so returning the raw sys.foreign_keys value would mislabel the rule.
   */
  private static String jdbcActionCase(String column) {
    return "CASE " + column
        + " WHEN 0 THEN 3"
        + " WHEN 1 THEN 0"
        + " WHEN 2 THEN 2"
        + " WHEN 3 THEN 4"
        + " ELSE 3 END";
  }

  @Override
  public void collectTableForeignKeys(
      Connection connection,
      String catalog,
      String schemaName,
      String tableName,
      ArrayNode foreignKeys)
      throws SQLException {
    if (catalog != null && !catalog.isBlank()) {
      collectTableForeignKeysInCatalog(connection, catalog, schemaName, tableName, foreignKeys);
      return;
    }
    DatabaseMetaData metadata = connection.getMetaData();
    try (ResultSet rs = metadata.getImportedKeys(null, schemaName, tableName)) {
      MetadataForeignKeys.appendFromResultSet(rs, foreignKeys);
    }
  }

  private static void collectTableForeignKeysInCatalog(
      Connection connection,
      String catalog,
      String schemaName,
      String tableName,
      ArrayNode foreignKeys)
      throws SQLException {
    String prefix = CatalogQualifier.prefix(catalog);
    String sql =
        "SELECT fk.name AS FK_NAME, fc.name AS FKCOLUMN_NAME, pc.name AS PKCOLUMN_NAME, "
            + "ps.name AS PKTABLE_SCHEM, pt.name AS PKTABLE_NAME, fkc.constraint_column_id AS KEY_SEQ, "
            + jdbcActionCase("fk.update_referential_action") + " AS UPDATE_RULE, "
            + jdbcActionCase("fk.delete_referential_action") + " AS DELETE_RULE "
            + "FROM " + prefix + "sys.foreign_keys fk "
            + "JOIN " + prefix + "sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id "
            + "JOIN " + prefix + "sys.objects fo ON fo.object_id = fk.parent_object_id "
            + "JOIN " + prefix + "sys.schemas fs ON fs.schema_id = fo.schema_id "
            + "JOIN " + prefix + "sys.columns fc ON fc.object_id = fkc.parent_object_id AND fc.column_id = fkc.parent_column_id "
            + "JOIN " + prefix + "sys.objects pt ON pt.object_id = fk.referenced_object_id "
            + "JOIN " + prefix + "sys.schemas ps ON ps.schema_id = pt.schema_id "
            + "JOIN " + prefix + "sys.columns pc ON pc.object_id = fkc.referenced_object_id AND pc.column_id = fkc.referenced_column_id "
            + "WHERE fs.name = ? AND fo.name = ? "
            + "ORDER BY fk.name, fkc.constraint_column_id";
    try (PreparedStatement statement = connection.prepareStatement(sql)) {
      statement.setString(1, schemaName);
      statement.setString(2, tableName);
      try (ResultSet rs = statement.executeQuery()) {
        MetadataForeignKeys.appendFromResultSet(rs, foreignKeys);
      }
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
    if (catalog != null && !catalog.isBlank()) {
      collectTableReferencesInCatalog(connection, catalog, schemaName, tableName, references);
      return;
    }
    DatabaseMetaData metadata = connection.getMetaData();
    try (ResultSet rs = metadata.getExportedKeys(null, schemaName, tableName)) {
      MetadataReferences.appendFromResultSet(rs, references);
    }
  }

  private static void collectTableReferencesInCatalog(
      Connection connection,
      String catalog,
      String schemaName,
      String tableName,
      ArrayNode references)
      throws SQLException {
    String prefix = CatalogQualifier.prefix(catalog);
    String sql =
        "SELECT fk.name AS FK_NAME, fc.name AS FKCOLUMN_NAME, pc.name AS PKCOLUMN_NAME, "
            + "fs.name AS FKTABLE_SCHEM, fo.name AS FKTABLE_NAME, fkc.constraint_column_id AS KEY_SEQ, "
            + jdbcActionCase("fk.update_referential_action") + " AS UPDATE_RULE, "
            + jdbcActionCase("fk.delete_referential_action") + " AS DELETE_RULE "
            + "FROM " + prefix + "sys.foreign_keys fk "
            + "JOIN " + prefix + "sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id "
            + "JOIN " + prefix + "sys.objects fo ON fo.object_id = fk.parent_object_id "
            + "JOIN " + prefix + "sys.schemas fs ON fs.schema_id = fo.schema_id "
            + "JOIN " + prefix + "sys.columns fc ON fc.object_id = fkc.parent_object_id AND fc.column_id = fkc.parent_column_id "
            + "JOIN " + prefix + "sys.objects pt ON pt.object_id = fk.referenced_object_id "
            + "JOIN " + prefix + "sys.schemas ps ON ps.schema_id = pt.schema_id "
            + "JOIN " + prefix + "sys.columns pc ON pc.object_id = fkc.referenced_object_id AND pc.column_id = fkc.referenced_column_id "
            + "WHERE ps.name = ? AND pt.name = ? "
            + "ORDER BY fk.name, fkc.constraint_column_id";
    try (PreparedStatement statement = connection.prepareStatement(sql)) {
      statement.setString(1, schemaName);
      statement.setString(2, tableName);
      try (ResultSet rs = statement.executeQuery()) {
        MetadataReferences.appendFromResultSet(rs, references);
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
    String prefix = CatalogQualifier.prefix(catalog);
    String sql =
        "SELECT k.name AS NAME, CASE WHEN k.type = 'PK' THEN 'P' ELSE 'U' END AS TYPE, "
            + "c.name AS COLUMN_NAME, NULL AS CHECK_CLAUSE, ic.key_ordinal AS POS "
            + "FROM " + prefix + "sys.key_constraints k "
            + "JOIN " + prefix + "sys.tables t ON t.object_id = k.parent_object_id "
            + "JOIN " + prefix + "sys.schemas s ON s.schema_id = t.schema_id "
            + "JOIN " + prefix + "sys.index_columns ic "
            + "  ON ic.object_id = k.parent_object_id AND ic.index_id = k.unique_index_id "
            + "JOIN " + prefix + "sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id "
            + "WHERE s.name = ? AND t.name = ? "
            + "UNION ALL "
            + "SELECT cc.name, 'C', NULL, cc.definition, 0 "
            + "FROM " + prefix + "sys.check_constraints cc "
            + "JOIN " + prefix + "sys.tables t ON t.object_id = cc.parent_object_id "
            + "JOIN " + prefix + "sys.schemas s ON s.schema_id = t.schema_id "
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
      Connection connection,
      String catalog,
      String schemaName,
      String tableName,
      ArrayNode triggers)
      throws SQLException {
    String prefix = CatalogQualifier.prefix(catalog);
    String sql =
        "SELECT tr.name AS NAME, te.type_desc AS EVENT, "
            + "CASE WHEN tr.is_instead_of_trigger = 1 THEN 'INSTEAD OF' ELSE 'AFTER' END AS TIMING, "
            + "CAST(CASE WHEN tr.is_disabled = 1 THEN 0 ELSE 1 END AS BIT) AS ENABLED "
            + "FROM " + prefix + "sys.triggers tr "
            + "JOIN " + prefix + "sys.objects o ON o.object_id = tr.parent_id "
            + "JOIN " + prefix + "sys.schemas s ON s.schema_id = o.schema_id "
            + "LEFT JOIN " + prefix + "sys.trigger_events te ON te.object_id = tr.object_id "
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
      String catalog,
      String schemaName,
      String objectName,
      String kind,
      Boolean packageBody,
      ArrayNode dependencies)
      throws SQLException {
    String prefix = CatalogQualifier.prefix(catalog);
    String sql =
        "SELECT DISTINCT rs.name AS [SCHEMA], ro.name AS NAME, ro.type_desc AS TYPE, "
            + "CAST(NULL AS NVARCHAR(60)) AS DEPENDENCY_TYPE "
            + "FROM " + prefix + "sys.sql_expression_dependencies d "
            + "JOIN " + prefix + "sys.objects o ON o.object_id = d.referencing_id "
            + "JOIN " + prefix + "sys.schemas s ON s.schema_id = o.schema_id "
            + "JOIN " + prefix + "sys.objects ro ON ro.object_id = d.referenced_id "
            + "JOIN " + prefix + "sys.schemas rs ON rs.schema_id = ro.schema_id "
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
      String catalog,
      String schemaName,
      String objectName,
      String kind,
      Boolean packageBody,
      ArrayNode dependents)
      throws SQLException {
    String prefix = CatalogQualifier.prefix(catalog);
    String sql =
        "SELECT DISTINCT s2.name AS [SCHEMA], o2.name AS NAME, o2.type_desc AS TYPE, "
            + "CAST(NULL AS NVARCHAR(60)) AS DEPENDENCY_TYPE "
            + "FROM " + prefix + "sys.sql_expression_dependencies d "
            + "JOIN " + prefix + "sys.objects o2 ON o2.object_id = d.referencing_id "
            + "JOIN " + prefix + "sys.schemas s2 ON s2.schema_id = o2.schema_id "
            + "JOIN " + prefix + "sys.objects ot ON ot.object_id = d.referenced_id "
            + "JOIN " + prefix + "sys.schemas st ON st.schema_id = ot.schema_id "
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
  public String fetchTableComment(
      Connection connection, String catalog, String schemaName, String tableName)
      throws SQLException {
    // Same MS_Description extended-property mechanism as applyColumnComments below, but
    // minor_id = 0 selects the property on the object itself rather than one of its columns.
    // Joins sys.objects (not sys.tables) so this covers views too.
    String prefix = CatalogQualifier.prefix(catalog);
    String sql =
        "SELECT CAST(ep.value AS NVARCHAR(MAX)) AS COMMENT "
            + "FROM " + prefix + "sys.objects o "
            + "JOIN " + prefix + "sys.schemas s ON s.schema_id = o.schema_id "
            + "LEFT JOIN " + prefix + "sys.extended_properties ep "
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
      Connection connection, String catalog, String schemaName, String tableName, ArrayNode columns)
      throws SQLException {
    if (columns.isEmpty()) {
      return;
    }

    String prefix = CatalogQualifier.prefix(catalog);
    String sql =
        "SELECT c.name AS COLUMN_NAME, CAST(ep.value AS NVARCHAR(MAX)) AS REMARKS "
            + "FROM " + prefix + "sys.columns c "
            + "JOIN " + prefix + "sys.objects o ON o.object_id = c.object_id "
            + "JOIN " + prefix + "sys.schemas s ON s.schema_id = o.schema_id "
            + "JOIN " + prefix + "sys.extended_properties ep "
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

  /**
   * SQL Server stores column defaults as named constraints ({@code sys.default_constraints}),
   * not as a plain column attribute — changing or dropping a default requires dropping this
   * constraint by name first. Neither {@code getColumns()} nor {@code INFORMATION_SCHEMA.COLUMNS}
   * expose the constraint name, so fetch and merge it in separately (same shape as {@link
   * #applyColumnComments}).
   */
  private void applyColumnDefaultConstraintNames(
      Connection connection, String catalog, String schemaName, String tableName, ArrayNode columns)
      throws SQLException {
    if (columns.isEmpty()) {
      return;
    }

    String prefix = CatalogQualifier.prefix(catalog);
    String sql =
        "SELECT c.name AS COLUMN_NAME, dc.name AS CONSTRAINT_NAME "
            + "FROM " + prefix + "sys.default_constraints dc "
            + "JOIN " + prefix + "sys.columns c "
            + "  ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id "
            + "JOIN " + prefix + "sys.objects o ON o.object_id = dc.parent_object_id "
            + "JOIN " + prefix + "sys.schemas s ON s.schema_id = o.schema_id "
            + "WHERE s.name = ? AND o.name = ?";

    try (PreparedStatement statement = connection.prepareStatement(sql)) {
      statement.setString(1, schemaName);
      statement.setString(2, tableName);
      try (ResultSet rs = statement.executeQuery()) {
        while (rs.next()) {
          String columnName = rs.getString("COLUMN_NAME");
          String constraintName = rs.getString("CONSTRAINT_NAME");
          if (columnName == null || constraintName == null || constraintName.isBlank()) {
            continue;
          }
          for (JsonNode node : columns) {
            if (node instanceof ObjectNode objectNode
                && columnName.equals(objectNode.path("name").asText(null))) {
              objectNode.put("defaultConstraintName", constraintName);
              break;
            }
          }
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
    if (catalog != null && !catalog.isBlank()) {
      return collectPrimaryKeysInCatalog(connection, catalog, schemaName, tableName, keys);
    }
    List<String> candidates = new ArrayList<>();
    String currentSchema =
        MetadataTableScope.querySingleString(connection, "SELECT SCHEMA_NAME()");
    if (currentSchema != null) {
      candidates.add(currentSchema);
    }
    candidates.addAll(MetadataTableScope.sessionSchemaCandidates(connection));
    return MetadataTableScope.collectPrimaryKeys(
        connection, schemaName, tableName, keys, candidates, null);
  }

  private static String collectPrimaryKeysInCatalog(
      Connection connection,
      String catalog,
      String schemaName,
      String tableName,
      ArrayNode keys)
      throws SQLException {
    keys.removeAll();
    String prefix = CatalogQualifier.prefix(catalog);
    String effectiveSchema = schemaName == null ? "" : schemaName.trim();
    String sql =
        "SELECT c.name AS COLUMN_NAME, ic.key_ordinal AS KEY_SEQ, s.name AS SCHEMA_NAME "
            + "FROM " + prefix + "sys.key_constraints k "
            + "JOIN " + prefix + "sys.tables t ON t.object_id = k.parent_object_id "
            + "JOIN " + prefix + "sys.schemas s ON s.schema_id = t.schema_id "
            + "JOIN " + prefix + "sys.index_columns ic "
            + "  ON ic.object_id = k.parent_object_id AND ic.index_id = k.unique_index_id "
            + "JOIN " + prefix + "sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id "
            + "WHERE k.type = 'PK' AND t.name = ?"
            + (effectiveSchema.isBlank() ? "" : " AND s.name = ?")
            + " ORDER BY ic.key_ordinal";
    try (PreparedStatement statement = connection.prepareStatement(sql)) {
      int index = 1;
      statement.setString(index++, tableName);
      if (!effectiveSchema.isBlank()) {
        statement.setString(index, effectiveSchema);
      }
      String resolvedSchema = null;
      try (ResultSet rs = statement.executeQuery()) {
        while (rs.next()) {
          String columnName = rs.getString("COLUMN_NAME");
          if (columnName == null || columnName.isBlank()) {
            continue;
          }
          if (resolvedSchema == null) {
            resolvedSchema = rs.getString("SCHEMA_NAME");
          }
          keys.addObject().put("name", columnName);
        }
      }
      return resolvedSchema;
    }
  }

  @Override
  public String resolveRelationKind(
      Connection connection, String catalog, String schemaName, String tableName)
      throws SQLException {
    if (catalog == null || catalog.isBlank()) {
      return MetadataRelationKind.resolveViaJdbc(connection, null, schemaName, tableName);
    }
    String prefix = CatalogQualifier.prefix(catalog);
    String sql =
        "SELECT o.type AS OBJ_TYPE FROM " + prefix + "sys.objects o "
            + "JOIN " + prefix + "sys.schemas s ON s.schema_id = o.schema_id "
            + "WHERE s.name = ? AND o.name = ? AND o.type IN ('U', 'V')";
    try (PreparedStatement statement = connection.prepareStatement(sql)) {
      statement.setString(1, schemaName);
      statement.setString(2, tableName);
      try (ResultSet rs = statement.executeQuery()) {
        if (rs.next()) {
          String type = rs.getString("OBJ_TYPE");
          return "V".equals(type == null ? null : type.trim()) ? "view" : "table";
        }
      }
    }
    return null;
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
    if ("table".equals(kind)) {
      return fetchSqlServerTableDdl(connection, catalog, schemaName, objectName);
    }

    String objectType =
        switch (kind) {
          case "view" -> "V";
          case "procedure" -> "P";
          case "function" -> "FN";
          case "trigger" -> "TR";
          default -> throw new RuntimeException("Unsupported object kind for DDL: " + kind);
        };

    String prefix = CatalogQualifier.prefix(catalog);
    String sql =
        "SELECT m.definition "
            + "FROM " + prefix + "sys.sql_modules m "
            + "INNER JOIN " + prefix + "sys.objects o ON m.object_id = o.object_id "
            + "INNER JOIN " + prefix + "sys.schemas s ON o.schema_id = s.schema_id "
            + "WHERE s.name = ? AND o.name = ? AND o.type = ?";
    String definition;
    try (PreparedStatement statement = connection.prepareStatement(sql)) {
      statement.setString(1, schemaName);
      statement.setString(2, objectName);
      statement.setString(3, objectType);
      try (ResultSet rs = statement.executeQuery()) {
        definition = MetadataDdl.readFirstColumnAsString(rs);
      }
    }
    if (definition == null || definition.isBlank() || !"view".equals(kind)) {
      return definition;
    }
    definition = normalizeSqlServerViewHeader(definition);

    // MS_Description doesn't touch the view's query, so — same as the table DDL builder and for
    // the same "round-trips through Save" reason documented on the Postgres equivalent — it's
    // appended as trailing EXEC sp_addextendedproperty statements after a terminating ';'.
    String tableComment = fetchTableComment(connection, catalog, schemaName, objectName);
    ArrayNode columns = JsonNodeFactory.instance.arrayNode();
    collectTableColumns(connection, catalog, schemaName, objectName, columns);

    String base = definition.stripTrailing();
    if (base.endsWith(";")) {
      base = base.substring(0, base.length() - 1).stripTrailing();
    }
    StringBuilder ddl = new StringBuilder(base);
    boolean terminated = false;
    if (tableComment != null && !tableComment.isBlank()) {
      ddl.append(";\n\n");
      terminated = true;
      ddl.append(
          buildSqlServerExtendedPropertyStatement(
              catalog, tableComment, schemaName, objectName, null, "VIEW"));
    }
    for (JsonNode column : columns) {
      String comment = column.path("comment").asText("");
      if (comment.isBlank()) {
        continue;
      }
      ddl.append(terminated ? "\n\n" : ";\n\n");
      terminated = true;
      ddl.append(
          buildSqlServerExtendedPropertyStatement(
              catalog, comment, schemaName, objectName, column.path("name").asText(""), "VIEW"));
    }
    return ddl.toString();
  }

  private String fetchSqlServerTableDdl(
      Connection connection, String catalog, String schemaName, String objectName)
      throws SQLException {
    String prefix = CatalogQualifier.prefix(catalog);
    String columnsSql =
        "SELECT c.COLUMN_NAME AS COLUMN_NAME, c.DATA_TYPE AS DATA_TYPE, "
            + "c.CHARACTER_MAXIMUM_LENGTH AS CHAR_LEN, c.NUMERIC_PRECISION AS NUM_PRECISION, "
            + "c.NUMERIC_SCALE AS NUM_SCALE, c.IS_NULLABLE AS IS_NULLABLE "
            + "FROM " + prefix + "INFORMATION_SCHEMA.COLUMNS c "
            + "WHERE c.TABLE_SCHEMA = ? AND c.TABLE_NAME = ? "
            + "ORDER BY c.ORDINAL_POSITION";
    List<String> columnLines = new ArrayList<>();
    try (PreparedStatement statement = connection.prepareStatement(columnsSql)) {
      statement.setString(1, schemaName);
      statement.setString(2, objectName);
      try (ResultSet rs = statement.executeQuery()) {
        while (rs.next()) {
          columnLines.add(formatSqlServerColumnLine(rs));
        }
      }
    }
    if (columnLines.isEmpty()) {
      return null;
    }

    ArrayNode constraints = JsonNodeFactory.instance.arrayNode();
    collectTableConstraints(connection, catalog, schemaName, objectName, constraints);
    ArrayNode foreignKeys = JsonNodeFactory.instance.arrayNode();
    collectTableForeignKeys(connection, catalog, schemaName, objectName, foreignKeys);
    ArrayNode indexes = JsonNodeFactory.instance.arrayNode();
    collectTableIndexes(connection, catalog, schemaName, objectName, indexes);
    ArrayNode columns = JsonNodeFactory.instance.arrayNode();
    collectTableColumns(connection, catalog, schemaName, objectName, columns);
    String tableComment = fetchTableComment(connection, catalog, schemaName, objectName);

    String qualifiedName = quoteSqlServerIdent(schemaName) + "." + quoteSqlServerIdent(objectName);
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
                    + quoteSqlServerIdent(name)
                    + " PRIMARY KEY ("
                    + MetadataDdl.joinQuotedColumns(constraint.path("columns"), this::quoteIdentifier)
                    + ")");
        case "unique" ->
            tableLines.add(
                "    CONSTRAINT "
                    + quoteSqlServerIdent(name)
                    + " UNIQUE ("
                    + MetadataDdl.joinQuotedColumns(constraint.path("columns"), this::quoteIdentifier)
                    + ")");
        case "check" ->
            tableLines.add(
                "    CONSTRAINT "
                    + quoteSqlServerIdent(name)
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
          .append(quoteSqlServerIdent(indexName))
          .append(" ON ")
          .append(qualifiedName)
          .append(" (")
          .append(MetadataDdl.joinQuotedColumns(index.path("columns"), this::quoteIdentifier))
          .append(");");
    }

    if (tableComment != null && !tableComment.isBlank()) {
      ddl.append("\n\n")
          .append(
              buildSqlServerExtendedPropertyStatement(
                  catalog, tableComment, schemaName, objectName, null, "TABLE"));
    }

    for (JsonNode column : columns) {
      String comment = column.path("comment").asText("");
      if (comment.isBlank()) {
        continue;
      }
      ddl.append("\n\n")
          .append(
              buildSqlServerExtendedPropertyStatement(
                  catalog, comment, schemaName, objectName, column.path("name").asText(""), "TABLE"));
    }

    return ddl.toString();
  }

  private static final Pattern SQLSERVER_VIEW_HEADER =
      Pattern.compile("(?i)^\\s*(?:CREATE(?:\\s+OR\\s+ALTER)?|ALTER)\\s+VIEW\\b");

  /**
   * {@code sys.sql_modules.definition} stores the view's source verbatim as originally
   * executed — {@code CREATE VIEW} if that's how it was first created, forever, even after
   * later edits (the frontend's Save path rewrites the leading keyword to {@code ALTER} only in
   * the statement it sends to the DB, never in what's stored/re-fetched). That means the DDL
   * text shown to the user doesn't match what Save actually runs, so copy-pasting it into a
   * script tab and executing it fails against an existing view ("there is already an object
   * named ..."). Normalizing to {@code CREATE OR ALTER VIEW} (supported since SQL Server 2016
   * SP1) here fixes that: the displayed text is now directly re-executable either way, and the
   * frontend's rewrite becomes a no-op for it (see buildPlsqlSaveSql.ts's matching guard).
   */
  private static String normalizeSqlServerViewHeader(String definition) {
    Matcher matcher = SQLSERVER_VIEW_HEADER.matcher(definition);
    if (!matcher.find()) {
      return definition;
    }
    return matcher.replaceFirst(Matcher.quoteReplacement("CREATE OR ALTER VIEW"));
  }

  private static String formatSqlServerColumnLine(ResultSet rs) throws SQLException {
    StringBuilder line = new StringBuilder("    ");
    line.append(quoteSqlServerIdent(rs.getString("COLUMN_NAME"))).append(' ');
    line.append(rs.getString("DATA_TYPE"));
    Integer charLen = rs.getObject("CHAR_LEN", Integer.class);
    Integer numPrecision = rs.getObject("NUM_PRECISION", Integer.class);
    Integer numScale = rs.getObject("NUM_SCALE", Integer.class);
    if (charLen != null) {
      line.append('(').append(charLen == -1 ? "max" : String.valueOf(charLen)).append(')');
    } else if (numPrecision != null) {
      line.append('(').append(numPrecision);
      if (numScale != null && numScale > 0) {
        line.append(',').append(numScale);
      }
      line.append(')');
    }
    if ("NO".equals(rs.getString("IS_NULLABLE"))) {
      line.append(" NOT NULL");
    }
    return line.toString();
  }

  /**
   * Builds an {@code EXEC sp_addextendedproperty} statement carrying an {@code MS_Description}
   * comment — the same mechanism {@link #fetchTableComment} and {@link #applyColumnComments}
   * read back. {@code columnName} is {@code null} for a table/view-level comment. {@code
   * level1Type} must be {@code "TABLE"} or {@code "VIEW"} to match the object being commented —
   * SQL Server tracks them as distinct {@code @level1type} values, not interchangeable.
   *
   * <p>{@code sp_addextendedproperty} errors ("Property cannot be added. Property
   * 'MS_Description' already exists...") if the property is already set — unlike Postgres'
   * {@code COMMENT ON} / Oracle's {@code COMMENT ON TABLE}, which always overwrite. Since a VIEW's
   * DDL text is re-executed on every Save (see the frontend's {@code buildPlsqlSaveSql}), a flat
   * {@code sp_addextendedproperty} call would only ever succeed once, so this wraps it as a single
   * {@code IF EXISTS(...) sp_updateextendedproperty ELSE sp_addextendedproperty} statement —
   * still one statement (no embedded {@code ;}, so the frontend's statement splitter doesn't
   * fragment it), safe to run any number of times.
   */
  private static String buildSqlServerExtendedPropertyStatement(
      String catalog,
      String value,
      String schemaName,
      String objectName,
      String columnName,
      String level1Type) {
    String prefix = CatalogQualifier.prefix(catalog);
    String quotedSchema = MetadataDdl.quoteStringLiteral(schemaName);
    String quotedObject = MetadataDdl.quoteStringLiteral(objectName);
    boolean hasColumn = columnName != null && !columnName.isBlank();

    // Queried directly against sys.extended_properties (same join shape as fetchTableComment/
    // applyColumnComments) rather than fn_listextendedproperty — that function treats a NULL
    // @level2type/@level2name argument as "match any level" rather than "match no level", which
    // would make an EXISTS check for the table/view-level comment also come back true when only
    // a *column*-level comment exists, picking the wrong branch below.
    StringBuilder existsCheck = new StringBuilder();
    existsCheck
        .append("SELECT 1 FROM ")
        .append(prefix)
        .append("sys.extended_properties ep JOIN ")
        .append(prefix)
        .append("sys.objects o ON o.object_id = ep.major_id JOIN ")
        .append(prefix)
        .append("sys.schemas s ON s.schema_id = o.schema_id ");
    if (hasColumn) {
      existsCheck
          .append("JOIN ")
          .append(prefix)
          .append("sys.columns c ON c.object_id = o.object_id AND c.column_id = ep.minor_id ");
    }
    existsCheck
        .append("WHERE ep.name = N'MS_Description' AND s.name = N")
        .append(quotedSchema)
        .append(" AND o.name = N")
        .append(quotedObject);
    if (hasColumn) {
      existsCheck.append(" AND c.name = N").append(MetadataDdl.quoteStringLiteral(columnName));
    } else {
      existsCheck.append(" AND ep.minor_id = 0");
    }

    StringBuilder call = new StringBuilder();
    call.append("@name = N'MS_Description', @value = N")
        .append(MetadataDdl.quoteStringLiteral(value))
        .append(", @level0type = N'SCHEMA', @level0name = N")
        .append(quotedSchema)
        .append(", @level1type = N'")
        .append(level1Type)
        .append("', @level1name = N")
        .append(quotedObject);
    if (hasColumn) {
      call.append(", @level2type = N'COLUMN', @level2name = N")
          .append(MetadataDdl.quoteStringLiteral(columnName));
    }

    return "IF EXISTS ("
        + existsCheck
        + ")\n    EXEC sys.sp_updateextendedproperty "
        + call
        + "\nELSE\n    EXEC sys.sp_addextendedproperty "
        + call
        + ";";
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

  private static String quoteSqlServerIdent(String value) {
    return "[" + value.replace("]", "]]") + "]";
  }

  @Override
  public String quoteIdentifier(String raw) {
    return quoteSqlServerIdent(raw);
  }

  /**
   * OFFSET/FETCH NEXT requires an ORDER BY on the outer query — when the caller has no active
   * sort, fall back to {@code ORDER BY (SELECT NULL)}, a standard zero-cost SQL Server idiom that
   * satisfies the syntax requirement without implying any real ordering or referencing a column.
   */
  @Override
  public String wrapPagedQuery(
      String innerSql, String whereFragment, String orderByFragment, int offset, int limit) {
    StringBuilder sql = new StringBuilder("SELECT * FROM (").append(innerSql).append(") sq");
    if (whereFragment != null && !whereFragment.isBlank()) {
      sql.append(" WHERE ").append(whereFragment);
    }
    sql.append(" ORDER BY ");
    if (orderByFragment != null && !orderByFragment.isBlank()) {
      sql.append(orderByFragment);
    } else {
      sql.append("(SELECT NULL)");
    }
    sql.append(" OFFSET ").append(offset).append(" ROWS FETCH NEXT ").append(limit)
        .append(" ROWS ONLY");
    return sql.toString();
  }
}
