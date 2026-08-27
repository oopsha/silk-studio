package com.silk.jdbcagent;

import com.fasterxml.jackson.databind.JsonNode;
import java.sql.Clob;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.function.Function;

/** Shared helpers for {@link DbDialect#fetchObjectDdl}. */
final class MetadataDdl {
  private MetadataDdl() {}

  /** Comma-joins a {@code columns}-shaped JSON array (see {@link MetadataConstraints}), quoting each name via {@code quoter}. */
  static String joinQuotedColumns(JsonNode columnsNode, Function<String, String> quoter) {
    StringBuilder out = new StringBuilder();
    if (columnsNode != null && columnsNode.isArray()) {
      for (JsonNode column : columnsNode) {
        if (out.length() > 0) {
          out.append(", ");
        }
        out.append(quoter.apply(column.asText()));
      }
    }
    return out.toString();
  }

  /** Escapes {@code value} as a single-quoted SQL string literal (doubling embedded quotes). */
  static String quoteStringLiteral(String value) {
    return "'" + value.replace("'", "''") + "'";
  }

  /**
   * Builds an {@code ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY} statement from a {@code
   * foreignKeys}-shaped JSON object (see {@link MetadataForeignKeys}). Emitted as a separate
   * ALTER (rather than inlined in the CREATE TABLE) so the generated DDL doesn't depend on the
   * referenced table already existing.
   */
  static String buildAddForeignKeyStatement(
      String qualifiedChildTable,
      JsonNode fk,
      Function<String, String> quoter,
      String defaultReferencedSchema) {
    String name = fk.path("name").asText("");
    String columns = joinQuotedColumns(fk.path("columns"), quoter);
    String referencedSchema = fk.path("referencedSchema").asText("");
    if (referencedSchema.isBlank()) {
      referencedSchema = defaultReferencedSchema;
    }
    String referencedTable = fk.path("referencedTable").asText("");
    String referencedColumns = joinQuotedColumns(fk.path("referencedColumns"), quoter);
    StringBuilder sql = new StringBuilder();
    sql.append("ALTER TABLE ")
        .append(qualifiedChildTable)
        .append(" ADD CONSTRAINT ")
        .append(quoter.apply(name))
        .append(" FOREIGN KEY (")
        .append(columns)
        .append(") REFERENCES ")
        .append(quoter.apply(referencedSchema))
        .append(".")
        .append(quoter.apply(referencedTable))
        .append(" (")
        .append(referencedColumns)
        .append(")");
    String updateRule = fk.path("updateRule").asText("");
    if (!updateRule.isBlank() && !"NO ACTION".equals(updateRule)) {
      sql.append(" ON UPDATE ").append(updateRule);
    }
    String deleteRule = fk.path("deleteRule").asText("");
    if (!deleteRule.isBlank() && !"NO ACTION".equals(deleteRule)) {
      sql.append(" ON DELETE ").append(deleteRule);
    }
    sql.append(";");
    return sql.toString();
  }

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
    return oracleMetadataType(kind, null);
  }

  static String oracleMetadataType(String kind, Boolean packageBody) {
    return switch (kind) {
      case "table" -> "TABLE";
      case "view" -> "VIEW";
      case "procedure" -> "PROCEDURE";
      case "function" -> "FUNCTION";
      case "package" ->
          Boolean.TRUE.equals(packageBody) ? "PACKAGE_BODY" : "PACKAGE";
      default -> throw new IllegalArgumentException("Unsupported object kind for DDL: " + kind);
    };
  }

  static java.util.List<String> oracleDependencyTypes(String kind, Boolean packageBody) {
    return switch (kind) {
      case "table" -> java.util.List.of("TABLE");
      case "view" -> java.util.List.of("VIEW");
      case "procedure" -> java.util.List.of("PROCEDURE");
      case "function" -> java.util.List.of("FUNCTION");
      case "package" -> {
        if (packageBody == null) {
          yield java.util.List.of("PACKAGE", "PACKAGE BODY");
        }
        yield packageBody ? java.util.List.of("PACKAGE BODY") : java.util.List.of("PACKAGE");
      }
      default ->
          throw new IllegalArgumentException(
              "Unsupported object kind for dependencies: " + kind);
    };
  }
}
