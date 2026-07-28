package com.silk.jdbcagent;

import java.sql.Clob;
import java.sql.ResultSet;
import java.sql.SQLException;

/** Shared helpers for {@link DbDialect#fetchObjectDdl}. */
final class MetadataDdl {
  private MetadataDdl() {}

  static String readFirstColumnAsString(ResultSet rs) throws SQLException {
    if (!rs.next()) {
      return null;
    }
    return readColumnAsString(rs, 1);
  }

  static String readAllFirstColumns(ResultSet rs, String separator) throws SQLException {
    StringBuilder out = new StringBuilder();
    while (rs.next()) {
      String value = readColumnAsString(rs, 1);
      if (value == null || value.isBlank()) {
        continue;
      }
      if (out.length() > 0) {
        out.append(separator);
      }
      out.append(value.trim());
    }
    return out.length() == 0 ? null : out.toString();
  }

  private static String readColumnAsString(ResultSet rs, int columnIndex) throws SQLException {
    Object value = rs.getObject(columnIndex);
    if (value == null) {
      return null;
    }
    if (value instanceof Clob clob) {
      long length = clob.length();
      if (length == 0) {
        return "";
      }
      if (length > Integer.MAX_VALUE) {
        throw new SQLException("DDL text is too large to return.");
      }
      return clob.getSubString(1, (int) length);
    }
    return value.toString();
  }

  static String oracleMetadataType(String kind) {
    return switch (kind) {
      case "table" -> "TABLE";
      case "view" -> "VIEW";
      case "procedure" -> "PROCEDURE";
      case "function" -> "FUNCTION";
      case "package" -> "PACKAGE";
      default -> throw new IllegalArgumentException("Unsupported object kind for DDL: " + kind);
    };
  }
}
