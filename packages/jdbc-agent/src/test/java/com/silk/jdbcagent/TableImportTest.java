package com.silk.jdbcagent;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.sql.*;
import org.junit.jupiter.api.Test;

class TableImportTest {
  private static final ObjectMapper JSON = new ObjectMapper();

  private ObjectNode request(String rows, boolean clear) throws Exception {
    ObjectNode params = (ObjectNode) JSON.readTree("{\"tableSql\":\"items\",\"columnSql\":\"id,amount,note\",\"columns\":[\"id\",\"amount\",\"note\"]}");
    params.set("rows", JSON.readTree(rows));
    params.put("clearExisting", clear);
    return params;
  }

  private Connection database() throws Exception {
    Connection connection = DriverManager.getConnection("jdbc:sqlite::memory:");
    connection.createStatement().execute("CREATE TABLE items (id INTEGER PRIMARY KEY, amount DECIMAL(18,3) NOT NULL, note VARCHAR(20))");
    return connection;
  }

  @Test void typedValuesPreserveDecimalAndTemporalPrecision() throws Exception {
    assertEquals(new java.math.BigDecimal("1234567890.123456789"), TableImport.convert(JSON.valueToTree("1234567890.123456789"), Types.DECIMAL));
    assertEquals(Timestamp.valueOf("2026-10-17 10:11:12.123456789"), TableImport.convert(JSON.valueToTree("2026-10-17 10:11:12.123456789"), Types.TIMESTAMP));
    assertEquals(java.time.LocalTime.parse("10:11:12.1234567"), TableImport.convert(JSON.valueToTree("10:11:12.1234567"), Types.TIME));
    assertInstanceOf(Timestamp.class, TableImport.convert(JSON.valueToTree("2026-10-17 10:11:12"), Types.DATE));
    assertThrows(ArithmeticException.class, () -> TableImport.convert(JSON.valueToTree("1.2"), Types.INTEGER));
  }

  private int count(Connection connection, String condition) throws Exception {
    try (Statement statement = connection.createStatement(); ResultSet rs = statement.executeQuery("SELECT count(*) FROM items WHERE " + condition)) {
      return rs.getInt(1);
    }
  }

  @Test void imports15996RowsWithoutDisplayLimitAndPreservesAmountsAndNulls() throws Exception {
    try (Connection connection = database()) {
      ObjectNode params = request("[]", false);
      var rows = params.putArray("rows");
      for (int i = 1; i <= 15996; i++) {
        var row = rows.addArray().add(String.valueOf(i)).add("1234.560");
        if (i % 2 == 0) row.addNull(); else row.add("");
      }
      var progress = new TableImport.Progress();
      var result = TableImport.execute(connection, params, progress);
      assertEquals(15996, result.path("completed").asInt());
      assertFalse(result.path("pendingCommit").asBoolean());
      assertEquals(15996, count(connection, "amount = 1234.560"));
      assertEquals(7998, count(connection, "note IS NULL"));
      assertEquals(7998, count(connection, "note = ''"));
      assertTrue(connection.getAutoCommit());
    }
  }

  @Test void laterBatchFailureRestoresDeletedRowsAndRemovesEarlierBatches() throws Exception {
    try (Connection connection = database()) {
      connection.createStatement().executeUpdate("INSERT INTO items VALUES (9999,42,'original')");
      ObjectNode params = request("[]", true);
      var rows = params.putArray("rows");
      for (int i = 1; i <= 501; i++) rows.addArray().add(String.valueOf(i == 501 ? 1 : i)).add("3.14").addNull();
      assertThrows(SQLException.class, () -> TableImport.execute(connection, params, new TableImport.Progress()));
      assertEquals(1, count(connection, "1=1"));
      assertEquals(1, count(connection, "id=9999 AND note='original'"));
    }
  }

  @Test void failurePreservesUnrelatedPendingWritesAndSuccessRemainsPending() throws Exception {
    try (Connection connection = database()) {
      connection.setAutoCommit(false);
      connection.createStatement().executeUpdate("INSERT INTO items VALUES (9,42,'prior')");
      assertThrows(SQLException.class, () -> TableImport.execute(connection,
          request("[[\"1\",\"3\",null],[\"1\",\"4\",null]]", true), new TableImport.Progress()));
      assertEquals(1, count(connection, "id=9"));
      var result = TableImport.execute(connection, request("[[\"1\",\"3\",\"NULL\"]]", false), new TableImport.Progress());
      assertTrue(result.path("pendingCommit").asBoolean());
      assertEquals(1, count(connection, "note='NULL'"));
      connection.rollback();
      assertEquals(0, count(connection, "1=1"));
    }
  }

  @Test void invalidNumericValueNeverTurnsIntoZeroOrDeletesOriginalData() throws Exception {
    try (Connection connection = database()) {
      connection.createStatement().executeUpdate("INSERT INTO items VALUES (9,42,'original')");
      assertThrows(SQLException.class, () -> TableImport.execute(connection,
          request("[[\"1\",\"\",null]]", true), new TableImport.Progress()));
      assertEquals(1, count(connection, "id=9 AND amount=42"));
    }
  }

  @Test void cancellationAfterFirstBatchRollsBackEverything() throws Exception {
    try (Connection connection = database()) {
      connection.createStatement().executeUpdate("INSERT INTO items VALUES (9999,42,'original')");
      var progress = new TableImport.Progress();
      // Cancel after a real first JDBC batch, before the next 500 rows are sent.
      Connection wrapped = (Connection) Proxy.newProxyInstance(getClass().getClassLoader(), new Class<?>[]{Connection.class},
          (proxy, method, args) -> {
            try {
              Object value = method.invoke(connection, args);
              if (!method.getName().equals("prepareStatement")) return value;
              PreparedStatement statement = (PreparedStatement) value;
              return Proxy.newProxyInstance(getClass().getClassLoader(), new Class<?>[]{PreparedStatement.class}, (p, m, a) -> {
                try {
                  Object result = m.invoke(statement, a);
                  if (m.getName().equals("executeBatch")) progress.cancel();
                  return result;
                } catch (InvocationTargetException e) { throw e.getCause(); }
              });
            } catch (InvocationTargetException e) { throw e.getCause(); }
          });
      ObjectNode params = request("[]", true);
      var rows = params.putArray("rows");
      for (int i = 1; i <= 1001; i++) rows.addArray().add(String.valueOf(i)).add("3.14").addNull();
      SQLException error = assertThrows(SQLException.class, () -> TableImport.execute(wrapped, params, progress));
      assertEquals("57014", error.getSQLState(), error.toString());
      assertEquals(1, count(connection, "id=9999"));
      assertEquals(1, count(connection, "1=1"));
    }
  }
}
