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
        MetadataGroupId.FUNCTIONS);
  }

  @Override
  public List<String> listSchemaNames(Connection connection) throws SQLException {
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

  @Override
  public void collectTableColumns(
      Connection connection, String schemaName, String tableName, ArrayNode columns)
      throws SQLException {
    DatabaseMetaData metadata = connection.getMetaData();
    // Oracle unquoted identifiers are stored uppercased — try given case, then UPPER.
    String[] schemas = distinctCases(schemaName);
    String[] tables = distinctCases(tableName);
    for (String schema : schemas) {
      for (String table : tables) {
        try (ResultSet rs = metadata.getColumns(null, schema, table, "%")) {
          MetadataColumns.appendFromResultSet(rs, columns);
        }
        if (columns.size() > 0) {
          return;
        }
      }
    }
  }

  @Override
  public void collectPackageMembers(
      Connection connection, String schemaName, String packageName, ArrayNode members)
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
            String catalog = procedures.getString("PROCEDURE_CAT");
            if (catalog == null || !catalog.equalsIgnoreCase(pkg)) {
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
      Connection connection, String schemaName, String tableName, ArrayNode keys)
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

  @Override
  public String fetchObjectDdl(
      Connection connection,
      String schemaName,
      String objectName,
      String kind,
      Boolean packageBody)
      throws SQLException {
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
              return ddl.trim();
            }
          }
        }
      }
    }
    return null;
  }

  @Override
  public ObjectNode compileObject(
      Connection connection,
      String schemaName,
      String objectName,
      String kind,
      Boolean packageBody,
      com.fasterxml.jackson.databind.ObjectMapper mapper)
      throws SQLException {
    String normalizedKind = kind.trim().toLowerCase(java.util.Locale.ROOT);
    if (!normalizedKind.equals("procedure")
        && !normalizedKind.equals("function")
        && !normalizedKind.equals("package")) {
      throw new RuntimeException(
          "Compile is only supported for procedure, function, and package.");
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
      String schemaName,
      String objectName,
      String kind,
      Boolean packageBody,
      ArrayNode dependencies)
      throws SQLException {
    String normalizedKind = kind.trim().toLowerCase(java.util.Locale.ROOT);
    if (!normalizedKind.equals("procedure")
        && !normalizedKind.equals("function")
        && !normalizedKind.equals("package")) {
      throw new RuntimeException(
          "Dependencies are only supported for procedure, function, and package.");
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

  private static String[] distinctCases(String value) {
    String upper = value.toUpperCase(java.util.Locale.ROOT);
    if (value.equals(upper)) {
      return new String[] {value};
    }
    return new String[] {value, upper};
  }

  @Override
  public void collectSchemaObjects(Connection connection, String schemaName, ArrayNode objects)
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
