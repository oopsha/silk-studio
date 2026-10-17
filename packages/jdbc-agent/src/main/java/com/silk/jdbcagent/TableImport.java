package com.silk.jdbcagent;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigDecimal;
import java.sql.*;
import java.util.ArrayList;
import java.util.List;

/** One prepared INSERT, bounded JDBC batches, and an atomic transaction/savepoint per import. */
final class TableImport {
  static final int BATCH_SIZE = 500;

  static final class Progress {
    volatile int completed;
    volatile int total;
    volatile String phase = "validating";
    volatile boolean cancelled;
    boolean interruptible = true;
    volatile Statement statement;

    synchronized void cancel() {
      if (phase.equals("finishing") || phase.equals("done")) return;
      cancelled = true;
      Statement current = statement;
      if (current != null && interruptible) {
        try { current.cancel(); } catch (SQLException ignored) { }
      }
    }

    void checkCancelled() throws SQLException {
      if (cancelled) throw new SQLException("Import cancelled; import changes rolled back.", "57014");
    }

    ObjectNode snapshot() {
      ObjectNode result = JsonNodeFactory.instance.objectNode();
      result.put("completed", completed);
      result.put("total", total);
      result.put("phase", phase);
      return result;
    }
  }

  static ObjectNode execute(Connection connection, JsonNode params, Progress progress) throws SQLException {
    String table = params.path("tableSql").asText("");
    JsonNode columns = params.path("columns");
    JsonNode rows = params.path("rows");
    if (table.isBlank() || !columns.isArray() || columns.isEmpty() || !rows.isArray() || rows.isEmpty()) {
      throw new SQLException("Import requires a target table, columns and rows.");
    }
    if (params.path("readOnly").asBoolean(false) || connection.isReadOnly()) {
      throw new SQLException("Read-only mode is enabled. Import is blocked.");
    }
    progress.total = rows.size();
    // SQLite's interrupt can abort the entire outer transaction, including earlier pending edits.
    // Its local batches are cancelled at batch boundaries instead of calling sqlite3_interrupt.
    progress.interruptible = !connection.getMetaData().getDatabaseProductName().equalsIgnoreCase("SQLite");
    boolean autoCommit = connection.getAutoCommit();
    Savepoint savepoint = null;
    boolean transactionStarted = false;
    boolean transactionResolved = false;
    try {
      if (autoCommit) connection.setAutoCommit(false);
      else savepoint = connection.setSavepoint();
      transactionStarted = true;
      List<String> names = new ArrayList<>();
      for (JsonNode column : columns) names.add(column.asText());
      // tableSql and columnSql are quoted identifiers built by the same dialect code as grid saves.
      String columnSql = params.path("columnSql").asText("");
      int[] types = new int[names.size()];
      boolean[] required = new boolean[names.size()];
      try (Statement statement = connection.createStatement()) {
        progress.statement = statement;
        statement.setQueryTimeout(params.path("queryTimeoutSec").asInt(30));
        progress.checkCancelled();
        try (ResultSet rs = statement.executeQuery("SELECT " + columnSql + " FROM " + table + " WHERE 1=0")) {
          ResultSetMetaData meta = rs.getMetaData();
          if (meta.getColumnCount() != names.size()) throw new SQLException("Import column metadata mismatch.");
          for (int i = 0; i < names.size(); i++) {
            types[i] = meta.getColumnType(i + 1);
            required[i] = meta.isNullable(i + 1) == ResultSetMetaData.columnNoNulls;
          }
        }
      } finally { progress.statement = null; }

      // Validate the complete input before DELETE or INSERT. No coercion of invalid numbers to zero.
      for (int r = 0; r < rows.size(); r++) {
        progress.checkCancelled();
        JsonNode row = rows.get(r);
        if (!row.isArray() || row.size() != names.size()) throw new SQLException("Import row width mismatch: " + (r + 1));
        for (int c = 0; c < names.size(); c++) {
          try {
            if (row.get(c).isNull() && required[c]) throw new IllegalArgumentException("NOT NULL column");
            convert(row.get(c), types[c]);
          } catch (RuntimeException error) {
            throw new SQLException("Import file row " + (params.path("firstFileRow").asInt(1) + r) + ", column " + names.get(c) + ": " + error.getMessage(), error);
          }
        }
      }

      progress.phase = "inserting";
      if (params.path("clearExisting").asBoolean(false)) {
        try (Statement statement = connection.createStatement()) {
          progress.statement = statement;
          statement.setQueryTimeout(params.path("queryTimeoutSec").asInt(30));
          progress.checkCancelled();
          // DELETE is transactional on supported engines; TRUNCATE can implicitly commit on Oracle/MySQL.
          statement.executeUpdate("DELETE FROM " + table);
        } finally { progress.statement = null; }
      }
      String placeholders = String.join(",", java.util.Collections.nCopies(names.size(), "?"));
      try (PreparedStatement statement = connection.prepareStatement(
          "INSERT INTO " + table + " (" + columnSql + ") VALUES (" + placeholders + ")")) {
        progress.statement = statement;
        statement.setQueryTimeout(params.path("queryTimeoutSec").asInt(30));
        int batchStart = 0;
        for (int r = 0; r < rows.size(); r++) {
          progress.checkCancelled();
          for (int c = 0; c < names.size(); c++) {
            Object value = convert(rows.get(r).get(c), types[c]);
            if (value == null) statement.setNull(c + 1, types[c]);
            else if (types[c] == Types.DATE && value instanceof Timestamp timestamp) statement.setTimestamp(c + 1, timestamp);
            else statement.setObject(c + 1, value, types[c]);
          }
          statement.addBatch();
          if ((r + 1) % BATCH_SIZE == 0 || r + 1 == rows.size()) {
            try { statement.executeBatch(); }
            catch (SQLException error) {
              int first = params.path("firstFileRow").asInt(1);
              throw new SQLException("Import file rows " + (first + batchStart) + "–" + (first + r) + ": " + error.getMessage(),
                  error.getSQLState(), error.getErrorCode(), error);
            }
            statement.clearBatch();
            progress.completed = r + 1;
            batchStart = r + 1;
          }
        }
      } finally { progress.statement = null; }
      synchronized (progress) {
        progress.checkCancelled();
        progress.phase = "finishing";
      }
      if (autoCommit) connection.commit();
      else releaseSavepoint(connection, savepoint);
      transactionResolved = true;
      progress.phase = "done";
      ObjectNode result = progress.snapshot();
      result.put("pendingCommit", !autoCommit);
      return result;
    } catch (SQLException | RuntimeException error) {
      if (transactionStarted) {
        try {
          if (savepoint != null) connection.rollback(savepoint);
          else connection.rollback();
          releaseSavepoint(connection, savepoint);
          transactionResolved = true;
        } catch (SQLException rollbackError) {
          error.addSuppressed(rollbackError);
          throw new SQLException(error.getMessage() + "; rollback failed: " + rollbackError.getMessage(), error);
        }
      }
      if (progress.cancelled) throw new SQLException("Import cancelled; import changes rolled back.", "57014", error);
      throw error;
    } finally {
      // setAutoCommit(true) commits an unresolved transaction. Never do that if rollback failed.
      if (autoCommit && transactionStarted && transactionResolved) {
        try { connection.setAutoCommit(true); }
        catch (SQLException restoreError) {
          // The transaction is already resolved. Do not report a committed import as failed/retryable.
          System.err.println("Import transaction resolved, but connection settings could not be restored: " + restoreError.getMessage());
          try { connection.close(); } catch (SQLException ignored) { }
        }
      }
    }
  }

  private static void releaseSavepoint(Connection connection, Savepoint savepoint) {
    if (savepoint == null) return;
    // SQL Server has no RELEASE SAVEPOINT; rollback-to-savepoint still works there.
    try { connection.releaseSavepoint(savepoint); } catch (SQLException ignored) { }
  }

  static Object convert(JsonNode value, int type) {
    if (value.isNull()) return null;
    String text = value.asText();
    return switch (type) {
      case Types.INTEGER, Types.SMALLINT, Types.TINYINT, Types.BIGINT -> {
        BigDecimal number = new BigDecimal(text);
        number.toBigIntegerExact(); // Reject fractional IDs instead of silently rounding them.
        yield number;
      }
      case Types.DECIMAL, Types.NUMERIC, Types.REAL, Types.FLOAT, Types.DOUBLE -> new BigDecimal(text);
      case Types.BOOLEAN, Types.BIT -> {
        if (text.equals("1") || text.equalsIgnoreCase("true")) yield true;
        if (text.equals("0") || text.equalsIgnoreCase("false")) yield false;
        throw new IllegalArgumentException("Expected true/false or 1/0");
      }
      case Types.DATE -> text.length() > 10 ? java.sql.Timestamp.valueOf(text.replace('T', ' ')) : java.sql.Date.valueOf(text);
      case Types.TIME -> java.time.LocalTime.parse(text);
      case Types.TIMESTAMP -> java.sql.Timestamp.valueOf(text.replace('T', ' '));
      case Types.TIMESTAMP_WITH_TIMEZONE -> java.time.OffsetDateTime.parse(text.replace(' ', 'T'));
      case Types.TIME_WITH_TIMEZONE -> java.time.OffsetTime.parse(text);
      default -> text;
    };
  }
}
