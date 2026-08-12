package com.silk.jdbcagent;

import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.ResultSet;
import java.sql.SQLException;

/**
 * Shared helper for non-Oracle {@link DbDialect#collectObjectDependencies}/{@link
 * DbDialect#collectObjectDependents} implementations (Oracle has its own {@code
 * ALL_DEPENDENCIES}-based code). Each dialect's SQL must project columns aliased {@code SCHEMA,
 * NAME, TYPE, DEPENDENCY_TYPE} (last one nullable).
 */
final class MetadataDependencies {
  private MetadataDependencies() {}

  static void appendFromResultSet(ResultSet rs, ArrayNode dependencies) throws SQLException {
    while (rs.next()) {
      String schema = rs.getString("SCHEMA");
      String name = rs.getString("NAME");
      String type = rs.getString("TYPE");
      if (schema == null
          || schema.isBlank()
          || name == null
          || name.isBlank()
          || type == null
          || type.isBlank()) {
        continue;
      }
      ObjectNode entry = dependencies.addObject();
      entry.put("schema", schema.trim());
      entry.put("name", name.trim());
      entry.put("type", type.trim());
      String dependencyType = rs.getString("DEPENDENCY_TYPE");
      if (dependencyType != null && !dependencyType.isBlank()) {
        entry.put("dependencyType", dependencyType.trim());
      }
    }
  }
}
