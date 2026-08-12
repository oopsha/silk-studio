package com.silk.jdbcagent;

import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.TreeMap;

/**
 * Shared helper for {@link DbDialect#collectTableConstraints}. No JDBC metadata call covers
 * unique/check constraints, so each dialect runs its own SQL — but must project rows shaped as
 * {@code NAME, TYPE ('P'|'U'|'C'), COLUMN_NAME (nullable), CHECK_CLAUSE (nullable), POS} — and
 * this groups those flat rows into one JSON object per constraint.
 */
final class MetadataConstraints {
  private MetadataConstraints() {}

  private static final class ConstraintBuilder {
    String type;
    String checkClause;
    final TreeMap<Integer, String> columns = new TreeMap<>();
  }

  static void appendFromResultSet(ResultSet rs, ArrayNode constraints) throws SQLException {
    Map<String, ConstraintBuilder> byName = new LinkedHashMap<>();
    while (rs.next()) {
      String name = rs.getString("NAME");
      if (name == null || name.isBlank()) {
        continue;
      }
      ConstraintBuilder builder = byName.computeIfAbsent(name, key -> new ConstraintBuilder());
      String type = rs.getString("TYPE");
      if (type != null && !type.isBlank()) {
        builder.type = type.trim();
      }
      String column = rs.getString("COLUMN_NAME");
      if (column != null && !column.isBlank()) {
        builder.columns.put(rs.getInt("POS"), column);
      }
      String checkClause = rs.getString("CHECK_CLAUSE");
      if (checkClause != null && !checkClause.isBlank()) {
        builder.checkClause = checkClause.trim();
      }
    }
    for (Map.Entry<String, ConstraintBuilder> entry : byName.entrySet()) {
      ConstraintBuilder builder = entry.getValue();
      String kind =
          switch (builder.type == null ? "" : builder.type) {
            case "P" -> "primaryKey";
            case "U" -> "unique";
            case "C" -> "check";
            default -> null;
          };
      if (kind == null) {
        continue;
      }
      ObjectNode constraint = constraints.addObject();
      constraint.put("name", entry.getKey());
      constraint.put("type", kind);
      if (!builder.columns.isEmpty()) {
        ArrayNode columns = constraint.putArray("columns");
        for (String column : builder.columns.values()) {
          columns.add(column);
        }
      }
      if (builder.checkClause != null) {
        constraint.put("expression", builder.checkClause);
      }
    }
  }
}
