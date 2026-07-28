package com.silk.jdbcagent;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
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
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

public final class Main {
  private static final ObjectMapper MAPPER = new ObjectMapper();

  /**
   * Runs {@code query.execute} off the stdin reader thread so {@code query.cancel} can be
   * processed (and {@link Statement#cancel()} called) while a long query is in flight.
   */
  private static final ExecutorService QUERY_EXECUTOR =
      Executors.newSingleThreadExecutor(
          (runnable) -> {
            Thread thread = new Thread(runnable, "jdbc-agent-query");
            thread.setDaemon(true);
            return thread;
          });

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
      runtime.openConnection(MAPPER.createObjectNode());
      System.out.println(MAPPER.writeValueAsString(runtime.executeQuery(sql)));
    } catch (SQLException error) {
      System.err.println(formatSqlError(error));
      System.exit(1);
    } catch (Exception error) {
      System.err.println(error.getMessage() == null ? "Query failed." : error.getMessage());
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

        final JsonNode request;
        try {
          request = MAPPER.readTree(line);
        } catch (Throwable error) {
          ObjectNode response = MAPPER.createObjectNode();
          response.putNull("id");
          response.put("ok", false);
          ObjectNode err = response.putObject("error");
          err.put("message", describeThrowable(error, "Invalid request."));
          writeResponse(writer, response);
          continue;
        }

        String method = request.path("method").asText("");
        if ("query.execute".equals(method)) {
          // Keep reading stdin (for query.cancel) while execute runs on QUERY_EXECUTOR.
          QUERY_EXECUTOR.execute(
              () -> {
                ObjectNode response = handleRequest(runtime, request);
                writeResponse(writer, response);
              });
          continue;
        }

        ObjectNode response = handleRequest(runtime, request);
        writeResponse(writer, response);

        if (response.path("result").path("shutdown").asBoolean(false)) {
          break;
        }
      }
    } catch (Throwable error) {
      System.err.println(describeThrowable(error, "jdbc-agent server failed."));
      System.exit(1);
    } finally {
      QUERY_EXECUTOR.shutdownNow();
      try {
        QUERY_EXECUTOR.awaitTermination(2, TimeUnit.SECONDS);
      } catch (InterruptedException ignored) {
        Thread.currentThread().interrupt();
      }
    }
  }

  private static void writeResponse(PrintWriter writer, ObjectNode response) {
    synchronized (writer) {
      try {
        writer.println(MAPPER.writeValueAsString(response));
      } catch (Exception error) {
        System.err.println(describeThrowable(error, "Failed to write response."));
      }
    }
  }

  private static String describeThrowable(Throwable error, String fallback) {
    String message = error.getMessage();
    if (message != null && !message.isBlank()) {
      return message;
    }
    return error.getClass().getSimpleName() + (fallback == null ? "" : ": " + fallback);
  }

  private static ObjectNode handleRequest(AgentRuntime runtime, JsonNode request) {
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
          runtime.openConnection(params);
          response.put("ok", true);
          ObjectNode result = response.putObject("result");
          result.put("connected", true);
        }
        case "connection.close" -> {
          runtime.closeConnection();
          response.put("ok", true);
          ObjectNode result = response.putObject("result");
          result.put("connected", false);
        }
        case "connection.test" -> {
          runtime.testConnection(params);
          response.put("ok", true);
          ObjectNode result = response.putObject("result");
          result.put("connected", true);
          result.put("message", "Connection successful.");
        }
        case "connection.metadata" -> {
          runtime.requireConnection();
          response.put("ok", true);
          response.set("result", runtime.listMetadata(params));
        }
        case "connection.columns" -> {
          runtime.requireConnection();
          response.put("ok", true);
          response.set("result", runtime.listColumns(params));
        }
        case "query.execute" -> {
          String sql = params.path("sql").asText("").trim();
          if (sql.isEmpty()) {
            throw new RuntimeException("Missing params.sql");
          }
          runtime.requireConnection();
          response.put("ok", true);
          response.set("result", runtime.executeQuery(sql, params));
        }
        case "query.cancel" -> {
          boolean cancelled = runtime.cancelActiveQuery();
          response.put("ok", true);
          ObjectNode result = response.putObject("result");
          result.put("cancelled", cancelled);
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
    } catch (Throwable error) {
      // Broad on purpose: classpath/driver failures surface as Errors (e.g.
      // NoClassDefFoundError), and letting those escape would take down the whole
      // long-lived --serve process instead of just failing this one request.
      response.put("ok", false);
      ObjectNode err = response.putObject("error");
      err.put("message", describeThrowable(error, "Request failed."));
    }

    return response;
  }

  private static final class AgentRuntime implements AutoCloseable {
    private String url;
    private String user;
    private String password;
    private final int timeoutSeconds = intEnv("SILK_DB_QUERY_TIMEOUT_SEC", 30);
    private final int maxRows = intEnv("SILK_DB_MAX_ROWS", 200);
    private Connection connection;
    /** Resolved from the JDBC URL on {@link #openConnection}; see {@link DbDialects#forUrl}. */
    private DbDialect dialect;
    /** In-flight statement for {@link #cancelActiveQuery}; visible across threads. */
    private volatile Statement activeStatement;

    void openConnection(JsonNode params) throws SQLException {
      applyCredentials(params);
      ensureCredentials();
      dialect = DbDialects.forUrl(url);

      if (connection != null && !connection.isClosed()) {
        connection.close();
        connection = null;
      }

      connection = DriverManager.getConnection(url, user, password);
      dialect.afterConnect(connection, params);
    }

    void requireConnection() throws SQLException {
      if (connection == null || connection.isClosed()) {
        throw new SQLException(
            "Connection is not open. Connect a database profile in the Connections explorer.");
      }
    }

    void closeConnection() throws SQLException {
      if (connection == null) {
        return;
      }
      try {
        if (!connection.isClosed()) {
          connection.close();
        }
      } finally {
        connection = null;
      }
    }

    void testConnection(JsonNode params) throws SQLException {
      applyCredentials(params);
      ensureCredentials();
      DbDialect testDialect = DbDialects.forUrl(url);

      try (Connection testConnection = DriverManager.getConnection(url, user, password)) {
        // Also apply catalog/schema during test so an invalid namespace surfaces as a test
        // failure rather than only showing up later on the real connect.
        testDialect.afterConnect(testConnection, params);
        testDialect.testConnection(testConnection, timeoutSeconds);
      }
    }

    void applyConnectionSettings(JsonNode params) throws SQLException {
      if (connection == null || connection.isClosed()) {
        return;
      }
      if (params.has("autoCommit")) {
        connection.setAutoCommit(params.path("autoCommit").asBoolean(true));
      }
      if (params.has("readOnly")) {
        connection.setReadOnly(params.path("readOnly").asBoolean(false));
      }
    }

    ObjectNode executeQuery(String sql) throws SQLException {
      return executeQuery(sql, MAPPER.createObjectNode());
    }

    ObjectNode listMetadata(JsonNode params) throws SQLException {
      requireConnection();
      String schemaFilter = params.path("schema").asText("").trim();

      List<String> schemaNames = dialect.listSchemaNames(connection);
      if (!schemaFilter.isEmpty()) {
        schemaNames = schemaNames.stream()
            .filter((name) -> name.equalsIgnoreCase(schemaFilter))
            .toList();
        if (schemaNames.isEmpty()) {
          schemaNames = List.of(schemaFilter);
        }
      }

      boolean includeObjects = !schemaFilter.isEmpty();
      ArrayNode schemas = MAPPER.createArrayNode();
      for (String schemaName : schemaNames) {
        ObjectNode schemaNode = MAPPER.createObjectNode();
        schemaNode.put("name", schemaName);
        ArrayNode groups = schemaNode.putArray("groups");

        if (includeObjects) {
          ArrayNode objects = MAPPER.createArrayNode();
          dialect.collectSchemaObjects(connection, schemaName, objects);
          populateGroups(groups, dialect.supportedGroups(), objects);
        }

        schemas.add(schemaNode);
      }

      ObjectNode result = MAPPER.createObjectNode();
      result.set("schemas", schemas);
      return result;
    }

    ObjectNode listColumns(JsonNode params) throws SQLException {
      requireConnection();
      String schemaName = params.path("schema").asText("").trim();
      String tableName = params.path("table").asText("").trim();
      if (schemaName.isEmpty()) {
        throw new RuntimeException("Missing params.schema");
      }
      if (tableName.isEmpty()) {
        throw new RuntimeException("Missing params.table");
      }

      ArrayNode columns = MAPPER.createArrayNode();
      dialect.collectTableColumns(connection, schemaName, tableName, columns);

      ObjectNode result = MAPPER.createObjectNode();
      result.set("columns", columns);
      return result;
    }

    /**
     * Partitions the dialect's flat {@code objects} list (each tagged with a {@code kind}) into
     * one entry per {@code supportedGroups}, in that order. Every supported group is emitted even
     * when empty (e.g. "Packages" with 0 items), but groups the dialect doesn't declare as
     * supported never appear — this is what keeps e.g. MySQL from showing an Oracle-only
     * "Packages" group.
     */
    private void populateGroups(
        ArrayNode groupsOut, List<MetadataGroupId> supportedGroups, ArrayNode objects) {
      Map<MetadataGroupId, ArrayNode> byGroup = new LinkedHashMap<>();
      for (MetadataGroupId group : supportedGroups) {
        byGroup.put(group, MAPPER.createArrayNode());
      }

      for (JsonNode object : objects) {
        MetadataGroupId group = MetadataGroupId.forKind(object.path("kind").asText(""));
        ArrayNode bucket = group == null ? null : byGroup.get(group);
        if (bucket != null) {
          bucket.add(object);
        }
        // else: dialect emitted a kind outside its own supportedGroups() — dropped rather than
        // surfaced under a group the frontend doesn't expect for this database.
      }

      for (Map.Entry<MetadataGroupId, ArrayNode> entry : byGroup.entrySet()) {
        ObjectNode groupNode = groupsOut.addObject();
        groupNode.put("id", entry.getKey().id);
        groupNode.set("objects", entry.getValue());
      }
    }

    ObjectNode executeQuery(String sql, JsonNode params) throws SQLException {
      if (connection == null || connection.isClosed()) {
        throw new SQLException("Connection is not open.");
      }

      boolean readOnly = params.path("readOnly").asBoolean(false);
      if (readOnly && isWriteSql(sql)) {
        throw new RuntimeException(
            "Read-only mode is enabled. Write statements are blocked.");
      }

      applyConnectionSettings(params);

      int maxRowsOverride = params.path("maxRows").asInt(-1);
      int effectiveMaxRows = maxRowsOverride > 0 ? maxRowsOverride : maxRows;

      int timeoutOverride = params.path("queryTimeoutSec").asInt(-1);
      int effectiveTimeout = timeoutOverride > 0 ? timeoutOverride : timeoutSeconds;

      Statement statement = connection.createStatement();
      activeStatement = statement;
      try {
        statement.setQueryTimeout(effectiveTimeout);
        // Fetch one extra row so we can tell whether the result was truncated.
        statement.setMaxRows(effectiveMaxRows + 1);

        boolean hasResultSet = statement.execute(sql);
        if (hasResultSet) {
          try (ResultSet rs = statement.getResultSet()) {
            return formatResultSet(rs, effectiveMaxRows);
          }
        }

        int updated = statement.getUpdateCount();
        ObjectNode result = MAPPER.createObjectNode();
        result.put("kind", "update");
        result.putArray("columns");
        result.putArray("rows");
        result.put("rowCount", 0);
        result.put("updateCount", updated);
        result.put("truncated", false);
        result.put("message", "OK. " + updated + " row(s) affected.");
        return result;
      } finally {
        activeStatement = null;
        try {
          statement.close();
        } catch (SQLException ignored) {
        }
      }
    }

    /**
     * Best-effort cancel of the in-flight {@link #executeQuery}. Must be callable from another
     * thread while {@code statement.execute} is blocked (JDBC {@link Statement#cancel()}).
     */
    boolean cancelActiveQuery() {
      Statement statement = activeStatement;
      if (statement == null) {
        return false;
      }
      try {
        statement.cancel();
        return true;
      } catch (SQLException error) {
        return false;
      }
    }

    private void applyCredentials(JsonNode params) {
      if (params.hasNonNull("url")) {
        url = params.path("url").asText("").trim();
      } else if (url == null || url.isBlank()) {
        url = optionalEnv("SILK_DB_URL");
      }

      if (params.hasNonNull("user")) {
        user = params.path("user").asText("").trim();
      } else if (user == null || user.isBlank()) {
        user = optionalEnv("SILK_DB_USER");
      }

      if (params.has("password")) {
        password = params.path("password").asText("");
      } else if (password == null) {
        password = optionalEnv("SILK_DB_PASSWORD");
      }
    }

    private void ensureCredentials() {
      if (url == null || url.isBlank()) {
        throw new RuntimeException(
            "Missing JDBC URL. Provide connection.open params.url or SILK_DB_URL.");
      }
      if (user == null || user.isBlank()) {
        throw new RuntimeException(
            "Missing JDBC user. Provide connection.open params.user or SILK_DB_USER.");
      }
      if (password == null) {
        password = "";
      }
    }

    boolean isConnected() throws SQLException {
      return connection != null && !connection.isClosed();
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

  private static String optionalEnv(String key) {
    String value = System.getenv(key);
    if (value == null || value.isBlank()) {
      return null;
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

  private static boolean isWriteSql(String sql) {
    return sql.trim()
        .toLowerCase()
        .matches(
            "^(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|call|exec|execute)\\b.*");
  }

  private static String formatSqlError(SQLException error) {
    StringBuilder builder = new StringBuilder();
    builder.append("SQL execution failed");
    builder.append("\nMessage: ").append(error.getMessage());
    builder.append("\nSQLState: ").append(error.getSQLState());
    builder.append("\nErrorCode: ").append(error.getErrorCode());
    return builder.toString();
  }

  private static ObjectNode formatResultSet(ResultSet rs, int maxRows)
      throws SQLException {
    ResultSetMetaData metadata = rs.getMetaData();
    int columnCount = metadata.getColumnCount();
    String[] headers = uniqueColumnLabels(metadata);

    ArrayNode columns = MAPPER.createArrayNode();
    for (String header : headers) {
      columns.add(header);
    }

    ArrayNode rows = MAPPER.createArrayNode();
    boolean truncated = false;
    while (rs.next()) {
      if (rows.size() >= maxRows) {
        truncated = true;
        break;
      }
      ArrayNode row = MAPPER.createArrayNode();
      for (int i = 1; i <= columnCount; i++) {
        Object value = rs.getObject(i);
        if (value == null) {
          row.addNull();
        } else {
          row.add(String.valueOf(value));
        }
      }
      rows.add(row);
    }

    ObjectNode result = MAPPER.createObjectNode();
    result.put("kind", "resultSet");
    result.set("columns", columns);
    result.set("rows", rows);
    result.put("rowCount", rows.size());
    result.putNull("updateCount");
    result.put("truncated", truncated);
    if (truncated) {
      result.put(
          "message",
          rows.size() + " row(s) (truncated at maxRows=" + maxRows + ")");
    } else {
      result.put("message", rows.size() + " row(s)");
    }
    return result;
  }

  private static String[] uniqueColumnLabels(ResultSetMetaData metadata) throws SQLException {
    int columnCount = metadata.getColumnCount();
    String[] headers = new String[columnCount];
    Map<String, Integer> seen = new LinkedHashMap<>();

    for (int i = 1; i <= columnCount; i++) {
      String label = metadata.getColumnLabel(i);
      if (label == null || label.isBlank()) {
        label = "COLUMN_" + i;
      }
      int count = seen.getOrDefault(label, 0) + 1;
      seen.put(label, count);
      headers[i - 1] = count == 1 ? label : label + "_" + count;
    }
    return headers;
  }
}
