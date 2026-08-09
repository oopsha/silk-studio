package com.silk.jdbcagent;

import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.DatabaseMetaData;
import java.sql.ResultSet;
import java.sql.SQLException;

/** Shared helpers for {@link DbDialect#collectTableColumns}. */
final class MetadataColumns {
  private MetadataColumns() {}

  static void appendFromResultSet(ResultSet rs, ArrayNode columns) throws SQLException {
    while (rs.next()) {
      String name = rs.getString("COLUMN_NAME");
      if (name == null || name.isBlank()) {
        continue;
      }
      ObjectNode column = columns.addObject();
      column.put("name", name);
      String typeName = rs.getString("TYPE_NAME");
      if (typeName != null && !typeName.isBlank()) {
        column.put("typeName", typeName);
      }
      Integer columnSize = rs.getObject("COLUMN_SIZE", Integer.class);
      if (columnSize != null) {
        column.put("columnSize", columnSize);
      }
      Integer decimalDigits = rs.getObject("DECIMAL_DIGITS", Integer.class);
      if (decimalDigits != null) {
        column.put("decimalDigits", decimalDigits);
      }
      int nullable = rs.getInt("NULLABLE");
      if (nullable == DatabaseMetaData.columnNoNulls) {
        column.put("nullable", false);
      } else if (nullable == DatabaseMetaData.columnNullable) {
        column.put("nullable", true);
      }
      // columnNullableUnknown: leave the field out rather than guess.
      String defaultValue = rs.getString("COLUMN_DEF");
      if (defaultValue != null) {
        column.put("defaultValue", defaultValue);
      }
      String remarks = rs.getString("REMARKS");
      if (remarks != null && !remarks.isBlank()) {
        column.put("comment", remarks);
      }
    }
  }
}
