package com.silk.jdbcagent;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.function.Function;

/**
 * Translates the frontend's flat, versioned filter wire format (see
 * {@code filterModelTranslator.ts}'s {@code FilterColumnWire[]}) into a SQL WHERE fragment plus
 * an ordered list of bind values — shared across all 4 dialects so the AG-Grid filter-type-to-SQL
 * mapping exists in exactly one place. Column-name quoting is dialect-specific and supplied by the
 * caller via {@code quoteIdentifier} (each dialect's own {@link DbDialect#quoteIdentifier}).
 *
 * <p>Every column name is validated against {@code knownColumns} (the result's own column list,
 * sent by the frontend) before being quoted and embedded in the generated SQL text — this is the
 * SQL-injection gate for identifiers, which (unlike values) cannot be a JDBC bind parameter.
 */
final class FilterSqlBuilder {
  private FilterSqlBuilder() {}

  /**
   * Builds a WHERE fragment (no leading {@code WHERE} keyword) ANDing together each column's own
   * (possibly AND/OR-combined) conditions, appending each condition's bind value(s) to {@code
   * binds} in the exact order they appear in the returned SQL text. Returns {@code null} when
   * {@code filters} is null/empty/not an array (no filter active).
   *
   * @throws RuntimeException if a column name isn't in {@code knownColumns}, or a condition's
   *     {@code type} isn't recognized — both indicate a malformed/untrusted request rather than a
   *     normal empty-filter case, so they fail closed instead of silently dropping the condition.
   */
  static String buildWhereFragment(
      JsonNode filters,
      Set<String> knownColumns,
      Function<String, String> quoteIdentifier,
      List<String> binds) {
    if (filters == null || !filters.isArray() || filters.isEmpty()) {
      return null;
    }

    List<String> columnFragments = new ArrayList<>();
    for (JsonNode columnFilter : filters) {
      String column = columnFilter.path("column").asText("");
      if (column.isBlank() || !knownColumns.contains(column)) {
        throw new RuntimeException("Unknown filter column: " + column);
      }
      JsonNode conditionsNode = columnFilter.path("conditions");
      if (!conditionsNode.isArray() || conditionsNode.isEmpty()) {
        continue;
      }
      String quotedColumn = quoteIdentifier.apply(column);
      List<String> conditionFragments = new ArrayList<>();
      for (JsonNode condition : conditionsNode) {
        conditionFragments.add(buildCondition(quotedColumn, condition, binds));
      }
      String logic = "OR".equals(columnFilter.path("logic").asText("AND")) ? " OR " : " AND ";
      columnFragments.add(
          conditionFragments.size() == 1
              ? conditionFragments.get(0)
              : "(" + String.join(logic, conditionFragments) + ")");
    }

    return columnFragments.isEmpty() ? null : String.join(" AND ", columnFragments);
  }

  /**
   * Builds an ORDER BY fragment (no leading {@code ORDER BY} keyword) from the frontend's sort
   * wire format ({@code SortColumnWire[]} — {@code [{column, direction}]}). Returns {@code null}
   * when {@code sort} is null/empty/not an array (no sort active) — callers (e.g. {@link
   * DbDialect#wrapPagedQuery}) supply their own dialect-specific fallback for that case when their
   * pagination syntax requires an ORDER BY regardless (SQL Server).
   *
   * @throws RuntimeException if a column name isn't in {@code knownColumns} or {@code direction}
   *     isn't exactly {@code "asc"}/{@code "desc"} — both indicate a malformed/untrusted request.
   */
  static String buildOrderByFragment(
      JsonNode sort, Set<String> knownColumns, Function<String, String> quoteIdentifier) {
    if (sort == null || !sort.isArray() || sort.isEmpty()) {
      return null;
    }

    List<String> fragments = new ArrayList<>();
    for (JsonNode item : sort) {
      String column = item.path("column").asText("");
      if (column.isBlank() || !knownColumns.contains(column)) {
        throw new RuntimeException("Unknown sort column: " + column);
      }
      String direction = item.path("direction").asText("");
      if (!"asc".equals(direction) && !"desc".equals(direction)) {
        throw new RuntimeException("Invalid sort direction: " + direction);
      }
      fragments.add(quoteIdentifier.apply(column) + " " + direction.toUpperCase(java.util.Locale.ROOT));
    }
    return String.join(", ", fragments);
  }

  private static String buildCondition(String quotedColumn, JsonNode condition, List<String> binds) {
    String type = condition.path("type").asText("");
    String value = condition.hasNonNull("value") ? condition.path("value").asText() : null;
    switch (type) {
      case "contains":
        binds.add("%" + value + "%");
        return quotedColumn + " LIKE ?";
      case "notContains":
        binds.add("%" + value + "%");
        return quotedColumn + " NOT LIKE ?";
      case "equals":
        binds.add(value);
        return quotedColumn + " = ?";
      case "notEqual":
        binds.add(value);
        return quotedColumn + " <> ?";
      case "startsWith":
        binds.add(value + "%");
        return quotedColumn + " LIKE ?";
      case "endsWith":
        binds.add("%" + value);
        return quotedColumn + " LIKE ?";
      case "lessThan":
        binds.add(value);
        return quotedColumn + " < ?";
      case "lessThanOrEqual":
        binds.add(value);
        return quotedColumn + " <= ?";
      case "greaterThan":
        binds.add(value);
        return quotedColumn + " > ?";
      case "greaterThanOrEqual":
        binds.add(value);
        return quotedColumn + " >= ?";
      case "inRange":
        binds.add(value);
        binds.add(condition.hasNonNull("value2") ? condition.path("value2").asText() : null);
        return quotedColumn + " BETWEEN ? AND ?";
      case "blank":
        return quotedColumn + " IS NULL";
      case "notBlank":
        return quotedColumn + " IS NOT NULL";
      default:
        throw new RuntimeException("Unsupported filter type: " + type);
    }
  }
}
