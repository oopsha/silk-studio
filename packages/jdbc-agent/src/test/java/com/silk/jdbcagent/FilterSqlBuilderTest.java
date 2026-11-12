package com.silk.jdbcagent;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.DriverManager;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

class FilterSqlBuilderTest {
  private static final ObjectMapper JSON = new ObjectMapper();

  private String condition(DbDialect dialect, String column, String type, String value,
      List<String> binds) {
    var filters = JSON.createArrayNode();
    var filter = filters.addObject().put("column", column);
    filter.putArray("conditions").addObject().put("type", type).put("value", value);
    return FilterSqlBuilder.buildWhereFragment(filters, Set.of("name", "amount"), dialect, binds);
  }

  @Test void textFiltersNormalizeBothOperandsAcrossDialects() {
    var dialects = List.of(new OracleDialect(), new SqlServerDialect(),
        new PostgreSqlDialect(), new MySqlDialect(), new MariaDbDialect(), new SqliteDialect());
    for (DbDialect dialect : dialects) {
      String quoted = dialect.quoteIdentifier("name");
      String expression = dialect.caseInsensitiveFilterExpression(quoted);
      for (String type : List.of("contains", "notContains", "equals", "notEqual", "startsWith", "endsWith")) {
        var binds = new ArrayList<String>();
        String sql = condition(dialect, "name", type, "aBc", binds);
        assertTrue(sql.startsWith(expression), dialect.id() + ": " + sql);
        assertTrue(sql.endsWith("UPPER(?)"), sql);
        assertEquals(1, binds.size());
        assertTrue(binds.get(0).contains("aBc"));
      }
    }
    assertEquals("UPPER(CAST(\"amount\" AS TEXT))",
        new PostgreSqlDialect().caseInsensitiveFilterExpression("\"amount\""));
    assertEquals("UPPER(CONVERT(NVARCHAR(MAX), [amount]))",
        new SqlServerDialect().caseInsensitiveFilterExpression("[amount]"));
  }

  @Test void executesMixedCaseAndNumericFiltersWithoutChangingNullOrRangeSemantics() throws Exception {
    try (var connection = DriverManager.getConnection("jdbc:sqlite::memory:")) {
      connection.createStatement().execute("PRAGMA case_sensitive_like = ON");
      connection.createStatement().execute("CREATE TABLE items(name TEXT, amount INTEGER)");
      connection.createStatement().execute("INSERT INTO items VALUES ('AbCdE', 123), ('xyz', 456), (NULL, NULL)");
      var types = List.of("contains", "notContains", "equals", "notEqual", "startsWith", "endsWith");
      var values = List.of("bCd", "bCd", "aBcDe", "aBcDe", "aB", "De");
      for (int i = 0; i < types.size(); i++) {
        assertEquals(1, count(connection, "name", types.get(i), values.get(i)));
      }
      assertEquals(1, count(connection, "amount", "equals", "123"));
      assertEquals(1, count(connection, "amount", "greaterThan", "200"));
      assertEquals(1, count(connection, "name", "blank", ""));
      assertEquals(2, count(connection, "name", "notBlank", ""));
    }
  }

  private int count(java.sql.Connection connection, String column, String type, String value)
      throws Exception {
    var binds = new ArrayList<String>();
    String sql = condition(new SqliteDialect(), column, type, value, binds);
    try (var statement = connection.prepareStatement("SELECT count(*) FROM items WHERE " + sql)) {
      for (int i = 0; i < binds.size(); i++) statement.setString(i + 1, binds.get(i));
      try (var rows = statement.executeQuery()) {
        assertTrue(rows.next());
        return rows.getInt(1);
      }
    }
  }
}
