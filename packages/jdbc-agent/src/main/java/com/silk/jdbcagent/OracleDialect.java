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
