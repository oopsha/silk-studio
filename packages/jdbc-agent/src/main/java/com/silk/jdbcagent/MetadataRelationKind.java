package com.silk.jdbcagent;

import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Locale;

/**
 * Maps JDBC {@code TABLE_TYPE} (and dialect overrides) to Silk relation kinds used for
 * safe cell-update eligibility messaging: {@code table}, {@code view}, {@code
 * materializedView}.
 */
final class MetadataRelationKind {
  private MetadataRelationKind() {}

  static String fromJdbcTableType(String tableType) {
    if (tableType == null || tableType.isBlank()) {
      return null;
    }
    String upper = tableType.trim().toUpperCase(Locale.ROOT);
    if (upper.contains("MATERIALIZED")) {
      return "materializedView";
    }
    if (upper.contains("VIEW")) {
      return "view";
    }
    if (upper.contains("TABLE")) {
      return "table";
    }
    return null;
  }

  /**
   * Resolves relation kind via {@link DatabaseMetaData#getTables}. Returns {@code null} when
   * the object is not found or the type is unrecognized.
   */
  static String resolveViaJdbc(Connection connection, String schemaName, String tableName)
      throws SQLException {
    if (tableName == null || tableName.isBlank()) {
      return null;
    }
    DatabaseMetaData metadata = connection.getMetaData();
    String catalog = null;
    try {
      catalog = connection.getCatalog();
    } catch (SQLException ignored) {
      // Some drivers do not support catalogs.
    }

    String[] types = new String[] {"TABLE", "VIEW", "MATERIALIZED VIEW", "SYSTEM TABLE"};
    String schema = schemaName == null ? "" : schemaName.trim();

    if (!schema.isBlank()) {
      for (String schemaCase : MetadataTableScope.distinctCases(schema)) {
        String kind = tryGetTables(metadata, catalog, schemaCase, tableName, types);
        if (kind != null) {
          return kind;
        }
      }
      return null;
    }

    return tryGetTables(metadata, catalog, null, tableName, types);
  }

  private static String tryGetTables(
      DatabaseMetaData metadata,
      String catalog,
      String schemaName,
      String tableName,
      String[] types)
      throws SQLException {
    for (String tableCase : MetadataTableScope.distinctCases(tableName)) {
      try (ResultSet rs = metadata.getTables(catalog, schemaName, tableCase, types)) {
        while (rs.next()) {
          String kind = fromJdbcTableType(rs.getString("TABLE_TYPE"));
          if (kind != null) {
            return kind;
          }
        }
      } catch (SQLException ignored) {
        // Driver may reject MATERIALIZED VIEW in types[]; retry without it below.
      }
    }

    String[] fallbackTypes = new String[] {"TABLE", "VIEW", "SYSTEM TABLE"};
    for (String tableCase : MetadataTableScope.distinctCases(tableName)) {
      try (ResultSet rs = metadata.getTables(catalog, schemaName, tableCase, fallbackTypes)) {
        while (rs.next()) {
          String kind = fromJdbcTableType(rs.getString("TABLE_TYPE"));
          if (kind != null) {
            return kind;
          }
        }
      }
    }
    return null;
  }
}
