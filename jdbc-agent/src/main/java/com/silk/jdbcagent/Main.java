package com.silk.jdbcagent;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;

public final class Main {
  private static final ObjectMapper MAPPER = new ObjectMapper();

  private Main() {}

  public static void main(String[] args) {
    if (args.length >= 1 && "--serve".equals(args[0])) {
      runServer();
      return;
    }

    if (args.length < 2 || !"query.execute".equals(args[0])) {
      System.err.println("Usage: java -jar jdbc-agent-all.jar --serve");
      System.err.println("   or: java -jar jdbc-agent-all.jar query.execute \"<sql>\"");
      System.exit(2);
      return;
    }

    String sql = args[1];
    try (AgentRuntime runtime = new AgentRuntime()) {
      runtime.openConnection();
      System.out.println(runtime.executeQuery(sql));
    } catch (SQLException error) {
      System.err.println(formatSqlError(error));
      System.exit(1);
    } catch (RuntimeException error) {
      System.err.println(error.getMessage());
      System.exit(1);
    }
  }

  private static void runServer() {
    try (AgentRuntime runtime = new AgentRuntime();
         BufferedReader reader =
             new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
         PrintWriter writer =
             new PrintWriter(new OutputStreamWriter(System.out, StandardCharsets.UTF_8), true)) {
      String line;
      while ((line = reader.readLine()) != null) {
        if (line.isBlank()) {
          continue;
        }

        ObjectNode response;
        try {
          JsonNode request = MAPPER.readTree(line);
          response = handleRequest(runtime, request);
        } catch (Exception error) {
          response = MAPPER.createObjectNode();
          response.putNull("id");
          response.put("ok", false);
          ObjectNode err = response.putObject("error");
          err.put("message", error.getMessage() == null ? "Invalid request." : error.getMessage());
        }

        writer.println(MAPPER.writeValueAsString(response));

        if (response.path("result").path("shutdown").asBoolean(false)) {
          break;
        }
      }
    } catch (Exception error) {
      System.err.println(error.getMessage() == null ? "jdbc-agent server failed." : error.getMessage());
      System.exit(1);
    }
  }

  private static ObjectNode handleRequest(AgentRuntime runtime, JsonNode request) throws SQLException {
    String method = request.path("method").asText("");
    JsonNode id = request.get("id");
    JsonNode params = request.path("params");

    ObjectNode response = MAPPER.createObjectNode();
    response.set("id", id == null ? MAPPER.nullNode() : id);

    try {
      switch (method) {
        case "agent.ping" -> {
          response.put("ok", true);
          ObjectNode result = response.putObject("result");
          result.put("message", "pong");
        }
        case "connection.open" -> {
          runtime.openConnection();
          response.put("ok", true);
          ObjectNode result = response.putObject("result");
          result.put("connected", true);
        }
        case "query.execute" -> {
          String sql = params.path("sql").asText("").trim();
          if (sql.isEmpty()) {
            throw new RuntimeException("Missing params.sql");
          }
          runtime.openConnection();
          String output = runtime.executeQuery(sql);
          response.put("ok", true);
          ObjectNode result = response.putObject("result");
          result.put("output", output);
        }
        case "agent.shutdown" -> {
          response.put("ok", true);
          ObjectNode result = response.putObject("result");
          result.put("shutdown", true);
        }
        default -> throw new RuntimeException("Unknown method: " + method);
      }
    } catch (SQLException error) {
      response.put("ok", false);
      ObjectNode err = response.putObject("error");
      err.put("message", formatSqlError(error));
      err.put("sqlState", error.getSQLState());
      err.put("errorCode", error.getErrorCode());
    } catch (RuntimeException error) {
      response.put("ok", false);
      ObjectNode err = response.putObject("error");
      err.put("message", error.getMessage() == null ? "Request failed." : error.getMessage());
    }

    return response;
  }

  private static final class AgentRuntime implements AutoCloseable {
    private final String url = requiredEnv("SILK_DB_URL");
    private final String user = requiredEnv("SILK_DB_USER");
    private final String password = requiredEnv("SILK_DB_PASSWORD");
    private final int timeoutSeconds = intEnv("SILK_DB_QUERY_TIMEOUT_SEC", 30);
    private final int maxRows = intEnv("SILK_DB_MAX_ROWS", 200);
    private Connection connection;

    void openConnection() throws SQLException {
      if (connection == null || connection.isClosed()) {
        connection = DriverManager.getConnection(url, user, password);
      }
    }

    String executeQuery(String sql) throws SQLException {
      if (connection == null || connection.isClosed()) {
        throw new SQLException("Connection is not open.");
      }

      try (Statement statement = connection.createStatement()) {
        statement.setQueryTimeout(timeoutSeconds);
        statement.setMaxRows(maxRows);

        boolean hasResultSet = statement.execute(sql);
        if (hasResultSet) {
          try (ResultSet rs = statement.getResultSet()) {
            return formatResultSet(rs);
          }
        } else {
          int updated = statement.getUpdateCount();
          return "OK. " + updated + " row(s) affected.";
        }
      }
    }

    @Override
    public void close() {
      if (connection == null) return;
      try {
        connection.close();
      } catch (SQLException ignored) {
      }
    }
  }

  private static String requiredEnv(String key) {
    String value = System.getenv(key);
    if (value == null || value.isBlank()) {
      throw new RuntimeException(
          "Missing environment variable: " + key
              + "\nExample:"
              + "\nSILK_DB_URL=jdbc:oracle:thin:@localhost:1521/FREEPDB1"
              + "\nSILK_DB_USER=SYSTEM"
              + "\nSILK_DB_PASSWORD=your_password");
    }
    return value.trim();
  }

  private static int intEnv(String key, int fallback) {
    String value = System.getenv(key);
    if (value == null || value.isBlank()) {
      return fallback;
    }

    try {
      return Integer.parseInt(value.trim());
    } catch (NumberFormatException ignored) {
      return fallback;
    }
  }

  private static String formatSqlError(SQLException error) {
    StringBuilder builder = new StringBuilder();
    builder.append("SQL execution failed");
    builder.append("\nMessage: ").append(error.getMessage());
    builder.append("\nSQLState: ").append(error.getSQLState());
    builder.append("\nErrorCode: ").append(error.getErrorCode());
    return builder.toString();
  }

  private static String formatResultSet(ResultSet rs) throws SQLException {
    ResultSetMetaData metadata = rs.getMetaData();
    int columns = metadata.getColumnCount();
    List<String> headers = new ArrayList<>();
    for (int i = 1; i <= columns; i++) {
      headers.add(metadata.getColumnLabel(i));
    }

    List<List<String>> rows = new ArrayList<>();
    while (rs.next()) {
      List<String> row = new ArrayList<>(columns);
      for (int i = 1; i <= columns; i++) {
        Object value = rs.getObject(i);
        row.add(value == null ? "NULL" : String.valueOf(value));
      }
      rows.add(row);
    }

    StringBuilder builder = new StringBuilder();
    builder.append(String.join(" | ", headers)).append('\n');
    for (List<String> row : rows) {
      builder.append(String.join(" | ", row)).append('\n');
    }
    builder.append("\nRows: ").append(rows.size());
    return builder.toString().trim();
  }
}
