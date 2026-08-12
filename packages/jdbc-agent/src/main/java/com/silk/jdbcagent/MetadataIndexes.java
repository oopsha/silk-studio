package com.silk.jdbcagent;

import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.DatabaseMetaData;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.TreeMap;

/**
 * Shared helper for {@link DbDialect#collectTableIndexes} — wraps the driver-generic {@link
 * DatabaseMetaData#getIndexInfo}, which every JDBC driver implements the same way (unlike
 * triggers/check-constraints, which need per-dialect SQL).
 */
final class MetadataIndexes {
  private MetadataIndexes() {}

  private static final class IndexBuilder {
    boolean unique;
    final TreeMap<Integer, String> columns = new TreeMap<>();
  }

  static void appendFromResultSet(ResultSet rs, ArrayNode indexes) throws SQLException {
    Map<String, IndexBuilder> byName = new LinkedHashMap<>();
    while (rs.next()) {
      short type = rs.getShort("TYPE");
      if (type == DatabaseMetaData.tableIndexStatistic) {
        continue;
      }
      String name = rs.getString("INDEX_NAME");
      String columnName = rs.getString("COLUMN_NAME");
      if (name == null || name.isBlank() || columnName == null || columnName.isBlank()) {
        continue;
      }
      IndexBuilder builder = byName.computeIfAbsent(name, key -> new IndexBuilder());
      builder.unique = !rs.getBoolean("NON_UNIQUE");
      builder.columns.put(rs.getInt("ORDINAL_POSITION"), columnName);
    }
    for (Map.Entry<String, IndexBuilder> entry : byName.entrySet()) {
      IndexBuilder builder = entry.getValue();
      ObjectNode index = indexes.addObject();
      index.put("name", entry.getKey());
      index.put("unique", builder.unique);
      ArrayNode columns = index.putArray("columns");
      for (String column : builder.columns.values()) {
        columns.add(column);
      }
    }
  }
}
