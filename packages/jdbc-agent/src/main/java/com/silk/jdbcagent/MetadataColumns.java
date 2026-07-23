package com.silk.jdbcagent;

import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
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
    }
  }
}
