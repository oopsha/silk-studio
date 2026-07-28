package com.silk.jdbcagent;

import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;

/** Shared helpers for {@link DbDialect#collectPrimaryKeys}. */
final class MetadataPrimaryKeys {
  private MetadataPrimaryKeys() {}

  record RawKeyColumn(String name, int seq) {}

  static String appendFromResultSet(ResultSet rs, ArrayNode keys) throws SQLException {
    List<RawKeyColumn> columns = new ArrayList<>();
    String tableSchem = null;
    while (rs.next()) {
      if (tableSchem == null) {
        tableSchem = rs.getString("TABLE_SCHEM");
      }
      String name = rs.getString("COLUMN_NAME");
      if (name == null || name.isBlank()) {
        continue;
      }
      int seq = rs.getInt("KEY_SEQ");
      columns.add(new RawKeyColumn(name, seq > 0 ? seq : columns.size() + 1));
    }

    appendRawColumns(columns, keys);
    return tableSchem == null || tableSchem.isBlank() ? null : tableSchem.trim();
  }

  static void appendRawColumns(List<RawKeyColumn> columns, ArrayNode keys) {
    columns.sort(java.util.Comparator.comparingInt(RawKeyColumn::seq));
    for (RawKeyColumn column : columns) {
      ObjectNode key = keys.addObject();
      key.put("name", column.name());
    }
  }
}
