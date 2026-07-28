package com.silk.jdbcagent;

import com.fasterxml.jackson.databind.node.ArrayNode;
import java.sql.Connection;
import java.sql.DatabaseMetaData;
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

/** Resolves unqualified table names using the same JDBC session context as SELECT. */
final class MetadataTableScope {
  private MetadataTableScope() {}

  static String jdbcSchema(Connection connection) throws SQLException {
    try {
      String schema = connection.getSchema();
      if (schema != null && !schema.isBlank()) {
        return schema.trim();
      }
    } catch (SQLException ignored) {
      // Some drivers report unsupported; fall through to dialect-specific probes.
    }
    return null;
  }

  static String querySingleString(Connection connection, String sql) throws SQLException {
    try (Statement statement = connection.createStatement();
        ResultSet rs = statement.executeQuery(sql)) {
      if (!rs.next()) {
        return null;
      }
      String value = rs.getString(1);
      return value == null || value.isBlank() ? null : value.trim();
    }
  }

  static String[] distinctCases(String value) {
    String upper = value.toUpperCase(Locale.ROOT);
    if (value.equals(upper)) {
      return new String[] {value};
    }
    return new String[] {value, upper};
  }

  /**
   * Loads PK columns for {@code tableName}. When {@code schemaName} is blank, tries session
   * schema candidates then a unique metadata match across visible schemas.
   *
   * @return resolved schema/owner for the table, or {@code null} when PK metadata was not found
   */
  static String collectPrimaryKeys(
      Connection connection,
      String schemaName,
      String tableName,
      ArrayNode keys,
      List<String> sessionSchemaCandidates,
      String catalog)
      throws SQLException {
    keys.removeAll();
    DatabaseMetaData metadata = connection.getMetaData();

    if (!schemaName.isBlank()) {
      return tryPrimaryKeys(metadata, catalog, schemaName, tableName, keys);
    }

    Set<String> tried = new LinkedHashSet<>();
    for (String candidate : sessionSchemaCandidates) {
      if (candidate == null || candidate.isBlank()) {
        continue;
      }
      for (String schemaCase : distinctCases(candidate.trim())) {
        if (!tried.add(schemaCase)) {
          continue;
        }
        String resolved = tryPrimaryKeys(metadata, catalog, schemaCase, tableName, keys);
        if (resolved != null) {
          return resolved;
        }
      }
    }

    return findUniquePrimaryKeySchema(metadata, catalog, tableName, keys);
  }

  private static String tryPrimaryKeys(
      DatabaseMetaData metadata,
      String catalog,
      String schemaName,
      String tableName,
      ArrayNode keys)
      throws SQLException {
    for (String tableCase : distinctCases(tableName)) {
      keys.removeAll();
      try (ResultSet rs = metadata.getPrimaryKeys(catalog, schemaName, tableCase)) {
        String resolvedSchema = MetadataPrimaryKeys.appendFromResultSet(rs, keys);
        if (keys.size() > 0) {
          return firstNonBlank(resolvedSchema, schemaName);
        }
      }
    }
    return null;
  }

  private static String findUniquePrimaryKeySchema(
      DatabaseMetaData metadata, String catalog, String tableName, ArrayNode keys)
      throws SQLException {
    for (String tableCase : distinctCases(tableName)) {
      keys.removeAll();
      Map<String, List<MetadataPrimaryKeys.RawKeyColumn>> bySchema = new LinkedHashMap<>();
      try (ResultSet rs = metadata.getPrimaryKeys(catalog, null, tableCase)) {
        while (rs.next()) {
          String schema = rs.getString("TABLE_SCHEM");
          if (schema == null || schema.isBlank()) {
            continue;
          }
          String columnName = rs.getString("COLUMN_NAME");
          if (columnName == null || columnName.isBlank()) {
            continue;
          }
          bySchema
              .computeIfAbsent(schema.trim(), ignored -> new ArrayList<>())
              .add(new MetadataPrimaryKeys.RawKeyColumn(columnName, rs.getInt("KEY_SEQ")));
        }
      }

      if (bySchema.isEmpty()) {
        continue;
      }
      if (bySchema.size() > 1) {
        throw new RuntimeException(
            "Table "
                + tableName
                + " exists in multiple schemas ("
                + String.join(", ", bySchema.keySet())
                + "). Qualify the table in SQL (schema.table).");
      }

      Map.Entry<String, List<MetadataPrimaryKeys.RawKeyColumn>> entry =
          bySchema.entrySet().iterator().next();
      MetadataPrimaryKeys.appendRawColumns(entry.getValue(), keys);
      return entry.getKey();
    }
    return null;
  }

  static List<String> sessionSchemaCandidates(Connection connection) throws SQLException {
    List<String> candidates = new ArrayList<>();
    String jdbcSchema = jdbcSchema(connection);
    if (jdbcSchema != null) {
      candidates.add(jdbcSchema);
    }
    return candidates;
  }

  static String firstNonBlank(String... values) {
    for (String value : values) {
      if (value != null && !value.isBlank()) {
        return value.trim();
      }
    }
    return null;
  }
}
