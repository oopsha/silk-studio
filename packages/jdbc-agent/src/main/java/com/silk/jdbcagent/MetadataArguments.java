package com.silk.jdbcagent;

import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.DatabaseMetaData;
import java.sql.ResultSet;
import java.sql.SQLException;

/**
 * Shared helper for {@link DbDialect#collectRoutineArguments} — parses the {@link ResultSet}
 * from JDBC's {@code getProcedureColumns}/{@code getFunctionColumns}. These are two separate
 * standard methods with *different* {@code COLUMN_TYPE} constant sets (e.g.
 * {@code procedureColumnOut} is 4, {@code functionColumnOut} is 3) even though both share the
 * same result-set column names (`COLUMN_NAME`, `TYPE_NAME`, `COLUMN_TYPE`, `ORDINAL_POSITION`)
 * — {@code kind} picks which mapping applies.
 */
final class MetadataArguments {
  private MetadataArguments() {}

  static void appendFromResultSet(ResultSet rs, String kind, ArrayNode arguments)
      throws SQLException {
    boolean isFunction = "function".equals(kind);
    while (rs.next()) {
      String direction =
          isFunction
              ? functionDirection(rs.getInt("COLUMN_TYPE"))
              : procedureDirection(rs.getInt("COLUMN_TYPE"));
      // procedureColumnResult/functionColumnResult describe a result-set column, not a real
      // parameter or return value — skip those rows.
      if (direction == null) {
        continue;
      }

      ObjectNode argument = arguments.addObject();
      String name = rs.getString("COLUMN_NAME");
      if (name != null && !name.isBlank()) {
        argument.put("name", name);
      }
      String typeName = rs.getString("TYPE_NAME");
      if (typeName != null && !typeName.isBlank()) {
        argument.put("typeName", typeName);
      }
      argument.put("direction", direction);
      argument.put("position", rs.getInt("ORDINAL_POSITION"));
    }
  }

  private static String procedureDirection(int columnType) {
    if (columnType == DatabaseMetaData.procedureColumnIn) return "in";
    if (columnType == DatabaseMetaData.procedureColumnInOut) return "inout";
    if (columnType == DatabaseMetaData.procedureColumnOut) return "out";
    if (columnType == DatabaseMetaData.procedureColumnReturn) return "return";
    return null;
  }

  private static String functionDirection(int columnType) {
    if (columnType == DatabaseMetaData.functionColumnIn) return "in";
    if (columnType == DatabaseMetaData.functionColumnInOut) return "inout";
    if (columnType == DatabaseMetaData.functionColumnOut) return "out";
    if (columnType == DatabaseMetaData.functionReturn) return "return";
    return null;
  }
}
