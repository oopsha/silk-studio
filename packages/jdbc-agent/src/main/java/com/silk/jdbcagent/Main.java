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
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.sql.Statement;
import java.sql.Types;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

public final class Main {
  private static final ObjectMapper MAPPER = new ObjectMapper();

  /**
   * One single-thread executor per {@code connectionId}, created lazily and reused for the life
   * of the process (profiles reconnect with the same id, so the thread just sits idle between
   * sessions — cheap, and avoids any shutdown-ordering race with in-flight work on that id).
   *
   * <p>Every request that carries a {@code connectionId} (open/close/metadata/columns/ddl/
   * execute/…) is dispatched onto that connection's own thread instead of being handled inline
   * on the stdin-reading thread. This is what lets two different profiles' work run truly in
   * parallel while keeping a hard guarantee the old inline-dispatch relied on implicitly: a
   * {@link Connection} is only ever touched by one thread — its own connection's thread — for
   * its whole lifetime, so no explicit locking is needed around session state. {@code
   * query.execute} shares this same per-connection thread (rather than a separate global one)
   * precisely so it can never run concurrently with a metadata call against the same Connection.
   *
   * <p>{@code query.cancel} is the one exception: it must reach {@link Statement#cancel()} while
   * that connection's thread may still be busy running the query being cancelled, so it bypasses
   * this dispatch entirely and runs inline on the stdin-reading thread — safe because {@code
   * cancel()} is specified to be callable from a different thread while a statement executes.
   */
  private static final Map<String, ExecutorService> CONNECTION_EXECUTORS =
      new ConcurrentHashMap<>();

  private static ExecutorService executorFor(String connectionId) {
    return CONNECTION_EXECUTORS.computeIfAbsent(
        connectionId,
        id ->
            Executors.newSingleThreadExecutor(
                (runnable) -> {
                  Thread thread = new Thread(runnable, "jdbc-agent-conn-" + id);
                  thread.setDaemon(true);
                  return thread;
                }));
  }

  /** For the handful of RPCs with no {@code connectionId} (e.g. {@code connection.test}, which
   * opens its own ad-hoc connection) — keeps them off the stdin-reading thread without needing a
   * dedicated single-thread executor each. */
  private static final ExecutorService MISC_EXECUTOR =
      Executors.newCachedThreadPool(
          (runnable) -> {
            Thread thread = new Thread(runnable, "jdbc-agent-misc");
            thread.setDaemon(true);
            return thread;
          });

  private Main() {}

  public static void main(String[] args) {
    SslTrustStoreSupport.installWindowsRootTrustIfApplicable();

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
      ObjectNode openParams = MAPPER.createObjectNode();
      openParams.put("connectionId", "cli");
      String connectionId = runtime.openConnection(openParams);
      ObjectNode execParams = MAPPER.createObjectNode();
      execParams.put("connectionId", connectionId);
      System.out.println(MAPPER.writeValueAsString(runtime.executeQuery(sql, execParams)));
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

        // query.cancel must reach Statement#cancel() even while that connection's own thread is
        // still busy running the query being cancelled — see CONNECTION_EXECUTORS's doc comment.
        if ("query.cancel".equals(method)) {
          writeResponse(writer, handleRequest(runtime, request));
          continue;
        }

        // No connectionId yet to key a session thread on — trivial/instant, handle inline so
        // the shutdown-loop-break below stays simple and synchronous.
        if ("agent.ping".equals(method) || "agent.shutdown".equals(method)) {
          ObjectNode response = handleRequest(runtime, request);
          writeResponse(writer, response);
          if (response.path("result").path("shutdown").asBoolean(false)) {
            break;
          }
          continue;
        }

        // Everything else (open/close/metadata/columns/ddl/execute/…) runs on its connection's
        // own thread so one profile's slow round trip never blocks another's — see
        // CONNECTION_EXECUTORS's doc comment for the full reasoning.
        String connectionId = request.path("params").path("connectionId").asText("").trim();
        ExecutorService executor =
            connectionId.isEmpty() ? MISC_EXECUTOR : executorFor(connectionId);
        executor.execute(
            () -> {
              ObjectNode response = handleRequest(runtime, request);
              writeResponse(writer, response);
            });
      }
    } catch (Throwable error) {
      System.err.println(describeThrowable(error, "jdbc-agent server failed."));
      System.exit(1);
    } finally {
      MISC_EXECUTOR.shutdownNow();
      for (ExecutorService executor : CONNECTION_EXECUTORS.values()) {
        executor.shutdownNow();
      }
      try {
        MISC_EXECUTOR.awaitTermination(2, TimeUnit.SECONDS);
        for (ExecutorService executor : CONNECTION_EXECUTORS.values()) {
          executor.awaitTermination(2, TimeUnit.SECONDS);
        }
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
          String connectionId = runtime.openConnection(params);
          response.put("ok", true);
          ObjectNode result = response.putObject("result");
          result.put("connected", true);
          result.put("connectionId", connectionId);
        }
        case "connection.close" -> {
          runtime.closeConnection(requireConnectionId(params));
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
          response.put("ok", true);
          response.set("result", runtime.listMetadata(params));
        }
        case "connection.prefetchCatalog" -> {
          response.put("ok", true);
          response.set("result", runtime.prefetchCatalog(params));
        }
        case "connection.findObjectsByName" -> {
          response.put("ok", true);
          response.set("result", runtime.findObjectsByName(params));
        }
        case "connection.columns" -> {
          response.put("ok", true);
          response.set("result", runtime.listColumns(params));
        }
        case "connection.arguments" -> {
          response.put("ok", true);
          response.set("result", runtime.listArguments(params));
        }
        case "connection.packageMembers" -> {
          response.put("ok", true);
          response.set("result", runtime.listPackageMembers(params));
        }
        case "connection.primaryKeys" -> {
          response.put("ok", true);
          response.set("result", runtime.listPrimaryKeys(params));
        }
        case "connection.indexes" -> {
          response.put("ok", true);
          response.set("result", runtime.listIndexes(params));
        }
        case "connection.tableComment" -> {
          response.put("ok", true);
          response.set("result", runtime.getTableComment(params));
        }
        case "connection.foreignKeys" -> {
          response.put("ok", true);
          response.set("result", runtime.listForeignKeys(params));
        }
        case "connection.references" -> {
          response.put("ok", true);
          response.set("result", runtime.listReferences(params));
        }
        case "connection.constraints" -> {
          response.put("ok", true);
          response.set("result", runtime.listConstraints(params));
        }
        case "connection.triggers" -> {
          response.put("ok", true);
          response.set("result", runtime.listTriggers(params));
        }
        case "connection.ddl" -> {
          response.put("ok", true);
          response.set("result", runtime.fetchObjectDdl(params));
        }
        case "connection.compile" -> {
          response.put("ok", true);
          response.set("result", runtime.compileObject(params));
        }
        case "connection.dependencies" -> {
          response.put("ok", true);
          response.set("result", runtime.listObjectDependencies(params));
        }
        case "connection.dependents" -> {
          response.put("ok", true);
          response.set("result", runtime.listObjectDependents(params));
        }
        case "query.execute" -> {
          String sql = params.path("sql").asText("").trim();
          if (sql.isEmpty()) {
            throw new RuntimeException("Missing params.sql");
          }
          response.put("ok", true);
          response.set("result", runtime.executeQuery(sql, params));
        }
        case "query.cancel" -> {
          boolean cancelled = runtime.cancelActiveQuery(requireConnectionId(params));
          response.put("ok", true);
          ObjectNode result = response.putObject("result");
          result.put("cancelled", cancelled);
        }
        case "connection.commit" -> {
          response.put("ok", true);
          response.set("result", runtime.commitConnection(params));
        }
        case "connection.rollback" -> {
          response.put("ok", true);
          response.set("result", runtime.rollbackConnection(params));
        }
        case "connection.setCatalog" -> {
          response.put("ok", true);
          response.set("result", runtime.setCatalog(params));
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

  private static String requireConnectionId(JsonNode params) {
    String connectionId = params.path("connectionId").asText("").trim();
    if (connectionId.isEmpty()) {
      throw new RuntimeException("Missing params.connectionId");
    }
    return connectionId;
  }

  /** One live JDBC session keyed by {@code connectionId}. */
  private static final class Session {
    final String id;
    Connection connection;
    DbDialect dialect;
    /** In-flight statement for cancel; visible across threads. */
    volatile Statement activeStatement;

    Session(String id) {
      this.id = id;
    }

    void closeQuietly() {
      Statement statement = activeStatement;
      activeStatement = null;
      if (statement != null) {
        try {
          statement.cancel();
        } catch (SQLException ignored) {
        }
        try {
          statement.close();
        } catch (SQLException ignored) {
        }
      }
      Connection conn = connection;
      connection = null;
      if (conn != null) {
        try {
          if (!conn.isClosed()) {
            conn.close();
          }
        } catch (SQLException ignored) {
        }
      }
    }
  }

  private static final class AgentRuntime implements AutoCloseable {
    private final Map<String, Session> sessions = new ConcurrentHashMap<>();
    private final int timeoutSeconds = intEnv("SILK_DB_QUERY_TIMEOUT_SEC", 30);
    private final int maxRows = intEnv("SILK_DB_MAX_ROWS", 200);

    /**
     * Opens (or replaces) a session. Client may supply {@code connectionId}; otherwise a UUID is
     * generated. Returns the id used.
     */
    String openConnection(JsonNode params) throws SQLException {
      String connectionId = params.path("connectionId").asText("").trim();
      if (connectionId.isEmpty()) {
        connectionId = UUID.randomUUID().toString();
      }

      String url = resolveCredential(params, "url", "SILK_DB_URL");
      String user = resolveCredential(params, "user", "SILK_DB_USER");
      String password = resolvePassword(params);
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

      Session previous = sessions.remove(connectionId);
      if (previous != null) {
        previous.closeQuietly();
      }

      DbDialect dialect = DbDialects.forUrl(url);
      Properties connProps = new Properties();
      connProps.setProperty("user", user);
      connProps.setProperty("password", password);
      if (dialect instanceof OracleDialect) {
        // Oracle's driver reports getColumns() REMARKS as NULL unless this is set.
        connProps.setProperty("remarksReporting", "true");
      }
      Connection connection = DriverManager.getConnection(url, connProps);
      dialect.afterConnect(connection, params);

      Session session = new Session(connectionId);
      session.connection = connection;
      session.dialect = dialect;
      sessions.put(connectionId, session);
      return connectionId;
    }

    Session requireSession(JsonNode params) throws SQLException {
      return requireSession(requireConnectionId(params));
    }

    Session requireSession(String connectionId) throws SQLException {
      Session session = sessions.get(connectionId);
      if (session == null
          || session.connection == null
          || session.connection.isClosed()) {
        sessions.remove(connectionId);
        throw new SQLException(
            "Connection is not open ("
                + connectionId
                + "). Connect a database profile in the Connections explorer.");
      }
      return session;
    }

    /**
     * Reads and validates {@code params.catalog} (present on most metadata RPCs). Returns
     * {@code null} when absent — callers then fall back to the connection's current catalog,
     * matching pre-catalog-parameter behavior. Never calls {@code connection.setCatalog()} —
     * that would mutate this session for every other tab sharing the connection.
     */
    static String readCatalog(JsonNode params) {
      String catalog = params.path("catalog").asText("").trim();
      if (catalog.isEmpty()) {
        return null;
      }
      CatalogQualifier.requireSafe(catalog);
      return catalog;
    }

    void closeConnection(String connectionId) {
      Session session = sessions.remove(connectionId);
      if (session != null) {
        session.closeQuietly();
      }
    }

    void testConnection(JsonNode params) throws SQLException {
      String url = resolveCredential(params, "url", "SILK_DB_URL");
      String user = resolveCredential(params, "user", "SILK_DB_USER");
      String password = resolvePassword(params);
      if (url == null || url.isBlank()) {
        throw new RuntimeException(
            "Missing JDBC URL. Provide connection.test params.url or SILK_DB_URL.");
      }
      if (user == null || user.isBlank()) {
        throw new RuntimeException(
            "Missing JDBC user. Provide connection.test params.user or SILK_DB_USER.");
      }
      if (password == null) {
        password = "";
      }
      DbDialect testDialect = DbDialects.forUrl(url);

      try (Connection testConnection = DriverManager.getConnection(url, user, password)) {
        // Also apply catalog/schema during test so an invalid namespace surfaces as a test
        // failure rather than only showing up later on the real connect.
        testDialect.afterConnect(testConnection, params);
        testDialect.testConnection(testConnection, timeoutSeconds);
      }
    }

    void applyConnectionSettings(Session session, JsonNode params) throws SQLException {
      if (session.connection == null || session.connection.isClosed()) {
        return;
      }
      if (params.has("autoCommit")) {
        session.connection.setAutoCommit(params.path("autoCommit").asBoolean(true));
      }
      if (params.has("readOnly")) {
        session.connection.setReadOnly(params.path("readOnly").asBoolean(false));
      }
    }

    /**
     * Commits the current JDBC transaction when auto-commit is off.
     * When auto-commit is on, returns {@code committed:false, skipped:true} (nothing pending).
     */
    ObjectNode commitConnection(JsonNode params) throws SQLException {
      Session session = requireSession(params);
      ObjectNode result = MAPPER.createObjectNode();
      Connection connection = session.connection;
      if (connection == null || connection.isClosed()) {
        throw new SQLException("Connection is closed.");
      }
      if (connection.getAutoCommit()) {
        result.put("committed", false);
        result.put("skipped", true);
        result.put("reason", "autoCommit");
        return result;
      }
      connection.commit();
      result.put("committed", true);
      result.put("skipped", false);
      return result;
    }

    /**
     * Rolls back the current JDBC transaction when auto-commit is off.
     * When auto-commit is on, returns {@code rolledBack:false, skipped:true} (nothing to undo).
     */
    ObjectNode rollbackConnection(JsonNode params) throws SQLException {
      Session session = requireSession(params);
      ObjectNode result = MAPPER.createObjectNode();
      Connection connection = session.connection;
      if (connection == null || connection.isClosed()) {
        throw new SQLException("Connection is closed.");
      }
      if (connection.getAutoCommit()) {
        result.put("rolledBack", false);
        result.put("skipped", true);
        result.put("reason", "autoCommit");
        return result;
      }
      connection.rollback();
      result.put("rolledBack", true);
      result.put("skipped", false);
      return result;
    }

    /**
     * Sets the JDBC session catalog (SQL Server / MySQL database). Session-only —
     * does not change connection profile defaults on the client.
     */
    ObjectNode setCatalog(JsonNode params) throws SQLException {
      Session session = requireSession(params);
      ObjectNode result = MAPPER.createObjectNode();
      Connection connection = session.connection;
      if (connection == null || connection.isClosed()) {
        throw new SQLException("Connection is closed.");
      }
      String catalog = params.path("catalog").asText("").trim();
      if (catalog.isEmpty()) {
        throw new RuntimeException("Missing params.catalog");
      }
      connection.setCatalog(catalog);
      String current = connection.getCatalog();
      if (current != null && !current.isBlank()) {
        result.put("catalog", current);
      } else {
        result.put("catalog", catalog);
      }
      return result;
    }

    ObjectNode listMetadata(JsonNode params) throws SQLException {
      Session session = requireSession(params);
      Connection connection = session.connection;
      DbDialect dialect = session.dialect;
      String schemaFilter = params.path("schema").asText("").trim();
      String catalogFilter = readCatalog(params);
      boolean includeSecondaryKinds = params.path("includeSecondaryKinds").asBoolean(true);

      // SQL Server (and similar): top-level request returns catalog/database names only.
      if (dialect.usesCatalogExplorer()
          && schemaFilter.isEmpty()
          && catalogFilter == null) {
        ArrayNode catalogs = MAPPER.createArrayNode();
        for (String catalogName : dialect.listCatalogNames(connection)) {
          catalogs.addObject().put("name", catalogName);
        }
        ObjectNode result = MAPPER.createObjectNode();
        result.set("schemas", MAPPER.createArrayNode());
        result.set("catalogs", catalogs);
        String current = connection.getCatalog();
        if (current != null && !current.isBlank()) {
          result.put("currentCatalog", current);
        }
        return result;
      }

      // Never connection.setCatalog(catalogFilter) here — this Connection is shared by every
      // tab bound to this profile, and this RPC is a read. Each dialect scopes its own
      // getSchemas/getTables/raw-SQL calls to `catalogFilter` without touching session state.
      List<String> schemaNames = dialect.listSchemaNames(connection, catalogFilter);
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
          dialect.collectSchemaObjects(
              connection, catalogFilter, schemaName, includeSecondaryKinds, objects);
          populateGroups(groups, dialect.supportedGroups(), objects);
        }

        schemas.add(schemaNode);
      }

      ObjectNode result = MAPPER.createObjectNode();
      result.set("schemas", schemas);
      String current = connection.getCatalog();
      if (current != null && !current.isBlank()) {
        result.put("currentCatalog", current);
      }
      return result;
    }

    /**
     * Background-prefetch support (Ctrl+Shift+O search index): walks every schema in one
     * catalog (or, for dialects with no catalog concept, every schema in the whole profile)
     * and returns lightweight tables/views/procedures/functions for all of them in a single
     * response — collapsing what would otherwise be one {@link #listMetadata} round trip per
     * schema into exactly one round trip per catalog. That collapse is the whole point: with
     * dozens of catalogs each holding many schemas, doing this schema-by-schema from the
     * frontend means hundreds of Tauri {@code invoke()} calls firing in a burst, which was
     * empirically confirmed (by elimination — React re-render cost was ruled out first) to
     * saturate the WebView2 IPC/message pump on Windows badly enough to visibly delay keyboard
     * input app-wide for the whole burst. Looping schemas here instead means the JS side makes
     * one {@code invoke()} per catalog and simply awaits it while this loop runs — no repeated
     * JS↔native boundary crossings during the loop, regardless of how many schemas it covers.
     *
     * <p>Deliberately does *not* batch the underlying SQL into one join per catalog (that would
     * cut total wall-clock time too, not just IPC call count) — the confirmed user-facing bug
     * is about IPC call *count*, not prefetch duration, and doing per-schema JDBC calls inside
     * one Java-side loop already fixes that with far less new/dialect-specific code than a
     * hand-written bulk query per driver would need. Revisit if total prefetch duration itself
     * becomes the complaint.
     *
     * @param catalog Null/blank for dialects where {@link DbDialect#usesCatalogExplorer()} is
     *     false (MySQL/Oracle/PostgreSQL) — same convention {@link #listMetadata} uses.
     * @param maxObjects Safety cap mirrored from the frontend's own limit (see
     *     {@code MAX_PREFETCH_OBJECTS} in {@code explorerSearchPrefetchService.ts}) — stops
     *     early and reports {@code truncated:true} rather than accumulating unbounded memory
     *     against a legacy/ERP-scale instance with thousands of tables per schema.
     */
    ObjectNode prefetchCatalog(JsonNode params) throws SQLException {
      Session session = requireSession(params);
      Connection connection = session.connection;
      DbDialect dialect = session.dialect;
      String catalog = readCatalog(params);
      int maxObjects = params.path("maxObjects").asInt(300_000);
      // Wall-clock budget rather than a per-statement JDBC query timeout: bounds this call's
      // total duration without needing to touch every dialect's individual statement creation,
      // and gives a hard ceiling on how long connection.close/query.execute for this same
      // profile could ever queue behind an in-flight prefetch (see the threading doc comment
      // on CONNECTION_EXECUTORS — every request for one profile shares that profile's single
      // dedicated thread).
      long deadlineNanos = System.nanoTime() + (long) timeoutSeconds * 1_000_000_000L;

      List<String> schemaNames = dialect.listSchemaNames(connection, catalog);

      ArrayNode schemas = MAPPER.createArrayNode();
      int totalObjects = 0;
      boolean truncated = false;
      for (String schemaName : schemaNames) {
        if (System.nanoTime() >= deadlineNanos) {
          truncated = true;
          break;
        }
        if (totalObjects >= maxObjects) {
          truncated = true;
          break;
        }

        ObjectNode schemaNode = MAPPER.createObjectNode();
        schemaNode.put("name", schemaName);
        ArrayNode groups = schemaNode.putArray("groups");

        try {
          ArrayNode objects = MAPPER.createArrayNode();
          dialect.collectSchemaObjects(
              connection, catalog, schemaName, /* includeSecondaryKinds= */ false, objects);
          totalObjects += objects.size();
          populateGroups(groups, dialect.supportedGroups(), objects);
        } catch (SQLException ignored) {
          // Best-effort — one unreadable schema (permissions, etc.) just stays empty here
          // rather than aborting the whole catalog's prefetch.
        }

        schemas.add(schemaNode);
      }

      ObjectNode result = MAPPER.createObjectNode();
      result.set("schemas", schemas);
      result.put("truncated", truncated);
      if (truncated) {
        result.put(
            "message",
            "Prefetch stopped early (limit reached) — " + schemas.size() + "/"
                + schemaNames.size() + " schemas covered.");
      }
      return result;
    }

    /**
     * Finds tables/views named exactly {@code params.name}, across every schema (and, for
     * catalog-explorer dialects like SQL Server, every catalog/database) the connection can see
     * — backs the AI assistant's "find an object without knowing its schema" tool. See {@link
     * DbDialect#findObjectsByName} for why this is scoped to tables/views only.
     */
    ObjectNode findObjectsByName(JsonNode params) throws SQLException {
      Session session = requireSession(params);
      Connection connection = session.connection;
      DbDialect dialect = session.dialect;
      String name = params.path("name").asText("").trim();
      if (name.isEmpty()) {
        throw new RuntimeException("Missing params.name");
      }

      ArrayNode objects = MAPPER.createArrayNode();
      if (dialect.usesCatalogExplorer()) {
        for (String catalogName : dialect.listCatalogNames(connection)) {
          ArrayNode found = MAPPER.createArrayNode();
          dialect.findObjectsByName(connection, catalogName, name, found);
          for (JsonNode object : found) {
            ObjectNode tagged = objects.addObject();
            tagged.put("catalogName", catalogName);
            tagged.put("schemaName", object.path("schemaName").asText(""));
            tagged.put("name", object.path("name").asText(""));
            tagged.put("kind", object.path("kind").asText(""));
          }
        }
      } else {
        dialect.findObjectsByName(connection, null, name, objects);
      }

      ObjectNode result = MAPPER.createObjectNode();
      result.set("objects", objects);
      return result;
    }

    ObjectNode listColumns(JsonNode params) throws SQLException {
      Session session = requireSession(params);
      String catalog = readCatalog(params);
      String schemaName = params.path("schema").asText("").trim();
      String tableName = params.path("table").asText("").trim();
      if (schemaName.isEmpty()) {
        throw new RuntimeException("Missing params.schema");
      }
      if (tableName.isEmpty()) {
        throw new RuntimeException("Missing params.table");
      }

      ArrayNode columns = MAPPER.createArrayNode();
      session.dialect.collectTableColumns(
          session.connection, catalog, schemaName, tableName, columns);

      ObjectNode result = MAPPER.createObjectNode();
      result.set("columns", columns);
      return result;
    }

    ObjectNode listArguments(JsonNode params) throws SQLException {
      Session session = requireSession(params);
      String catalog = readCatalog(params);
      String schemaName = params.path("schema").asText("").trim();
      String routineName = params.path("name").asText("").trim();
      String kind = params.path("kind").asText("").trim().toLowerCase(java.util.Locale.ROOT);
      if (schemaName.isEmpty()) {
        throw new RuntimeException("Missing params.schema");
      }
      if (routineName.isEmpty()) {
        throw new RuntimeException("Missing params.name");
      }
      if (!"procedure".equals(kind) && !"function".equals(kind)) {
        throw new RuntimeException("params.kind must be \"procedure\" or \"function\"");
      }

      ArrayNode arguments = MAPPER.createArrayNode();
      session.dialect.collectRoutineArguments(
          session.connection, catalog, schemaName, routineName, kind, arguments);

      ObjectNode result = MAPPER.createObjectNode();
      result.set("arguments", arguments);
      return result;
    }

    ObjectNode getTableComment(JsonNode params) throws SQLException {
      Session session = requireSession(params);
      String catalog = readCatalog(params);
      String schemaName = params.path("schema").asText("").trim();
      String tableName = params.path("table").asText("").trim();
      if (schemaName.isEmpty()) {
        throw new RuntimeException("Missing params.schema");
      }
      if (tableName.isEmpty()) {
        throw new RuntimeException("Missing params.table");
      }

      String comment =
          session.dialect.fetchTableComment(session.connection, catalog, schemaName, tableName);

      ObjectNode result = MAPPER.createObjectNode();
      if (comment != null) {
        result.put("comment", comment);
      }
      return result;
    }

    ObjectNode listIndexes(JsonNode params) throws SQLException {
      Session session = requireSession(params);
      String catalog = readCatalog(params);
      String schemaName = params.path("schema").asText("").trim();
      String tableName = params.path("table").asText("").trim();
      if (schemaName.isEmpty()) {
        throw new RuntimeException("Missing params.schema");
      }
      if (tableName.isEmpty()) {
        throw new RuntimeException("Missing params.table");
      }

      ArrayNode indexes = MAPPER.createArrayNode();
      session.dialect.collectTableIndexes(
          session.connection, catalog, schemaName, tableName, indexes);

      ObjectNode result = MAPPER.createObjectNode();
      result.set("indexes", indexes);
      return result;
    }

    ObjectNode listForeignKeys(JsonNode params) throws SQLException {
      Session session = requireSession(params);
      String catalog = readCatalog(params);
      String schemaName = params.path("schema").asText("").trim();
      String tableName = params.path("table").asText("").trim();
      if (schemaName.isEmpty()) {
        throw new RuntimeException("Missing params.schema");
      }
      if (tableName.isEmpty()) {
        throw new RuntimeException("Missing params.table");
      }

      ArrayNode foreignKeys = MAPPER.createArrayNode();
      session.dialect.collectTableForeignKeys(
          session.connection, catalog, schemaName, tableName, foreignKeys);

      ObjectNode result = MAPPER.createObjectNode();
      result.set("foreignKeys", foreignKeys);
      return result;
    }

    ObjectNode listReferences(JsonNode params) throws SQLException {
      Session session = requireSession(params);
      String catalog = readCatalog(params);
      String schemaName = params.path("schema").asText("").trim();
      String tableName = params.path("table").asText("").trim();
      if (schemaName.isEmpty()) {
        throw new RuntimeException("Missing params.schema");
      }
      if (tableName.isEmpty()) {
        throw new RuntimeException("Missing params.table");
      }

      ArrayNode references = MAPPER.createArrayNode();
      session.dialect.collectTableReferences(
          session.connection, catalog, schemaName, tableName, references);

      ObjectNode result = MAPPER.createObjectNode();
      result.set("references", references);
      return result;
    }

    ObjectNode listConstraints(JsonNode params) throws SQLException {
      Session session = requireSession(params);
      String catalog = readCatalog(params);
      String schemaName = params.path("schema").asText("").trim();
      String tableName = params.path("table").asText("").trim();
      if (schemaName.isEmpty()) {
        throw new RuntimeException("Missing params.schema");
      }
      if (tableName.isEmpty()) {
        throw new RuntimeException("Missing params.table");
      }

      ArrayNode constraints = MAPPER.createArrayNode();
      session.dialect.collectTableConstraints(
          session.connection, catalog, schemaName, tableName, constraints);

      ObjectNode result = MAPPER.createObjectNode();
      result.set("constraints", constraints);
      return result;
    }

    ObjectNode listTriggers(JsonNode params) throws SQLException {
      Session session = requireSession(params);
      String catalog = readCatalog(params);
      String schemaName = params.path("schema").asText("").trim();
      String tableName = params.path("table").asText("").trim();
      if (schemaName.isEmpty()) {
        throw new RuntimeException("Missing params.schema");
      }
      if (tableName.isEmpty()) {
        throw new RuntimeException("Missing params.table");
      }

      ArrayNode triggers = MAPPER.createArrayNode();
      session.dialect.collectTableTriggers(
          session.connection, catalog, schemaName, tableName, triggers);

      ObjectNode result = MAPPER.createObjectNode();
      result.set("triggers", triggers);
      return result;
    }

    ObjectNode listPackageMembers(JsonNode params) throws SQLException {
      Session session = requireSession(params);
      String catalog = readCatalog(params);
      String schemaName = params.path("schema").asText("").trim();
      String packageName = params.path("package").asText("").trim();
      if (schemaName.isEmpty()) {
        throw new RuntimeException("Missing params.schema");
      }
      if (packageName.isEmpty()) {
        throw new RuntimeException("Missing params.package");
      }

      ArrayNode members = MAPPER.createArrayNode();
      session.dialect.collectPackageMembers(
          session.connection, catalog, schemaName, packageName, members);

      ObjectNode result = MAPPER.createObjectNode();
      result.set("members", members);
      return result;
    }

    ObjectNode listPrimaryKeys(JsonNode params) throws SQLException {
      Session session = requireSession(params);
      String catalog = readCatalog(params);
      String schemaName = params.path("schema").asText("").trim();
      String tableName = params.path("table").asText("").trim();
      if (tableName.isEmpty()) {
        throw new RuntimeException("Missing params.table");
      }

      ArrayNode keys = MAPPER.createArrayNode();
      String resolvedSchema =
          session.dialect.collectPrimaryKeys(
              session.connection, catalog, schemaName, tableName, keys);

      ObjectNode result = MAPPER.createObjectNode();
      result.set("keys", keys);
      if (resolvedSchema != null && !resolvedSchema.isBlank()) {
        result.put("schema", resolvedSchema);
      }
      String schemaForKind =
          resolvedSchema != null && !resolvedSchema.isBlank() ? resolvedSchema : schemaName;
      String relationKind =
          session.dialect.resolveRelationKind(
              session.connection, catalog, schemaForKind, tableName);
      if (relationKind != null && !relationKind.isBlank()) {
        result.put("relationKind", relationKind);
      }
      return result;
    }

    ObjectNode fetchObjectDdl(JsonNode params) throws SQLException {
      Session session = requireSession(params);
      String catalog = readCatalog(params);
      String schemaName = params.path("schema").asText("").trim();
      String objectName = params.path("name").asText("").trim();
      String kind = params.path("kind").asText("").trim().toLowerCase(java.util.Locale.ROOT);
      if (schemaName.isEmpty()) {
        throw new RuntimeException("Missing params.schema");
      }
      if (objectName.isEmpty()) {
        throw new RuntimeException("Missing params.name");
      }
      if (kind.isEmpty()) {
        throw new RuntimeException("Missing params.kind");
      }
      Boolean packageBody = null;
      if (params.hasNonNull("packageBody")) {
        packageBody = params.path("packageBody").asBoolean();
      }

      String ddl =
          session.dialect.fetchObjectDdl(
              session.connection, catalog, schemaName, objectName, kind, packageBody);
      if (ddl == null || ddl.isBlank()) {
        throw new RuntimeException(
            "No DDL found for " + schemaName + "." + objectName + " (" + kind + ").");
      }

      ObjectNode result = MAPPER.createObjectNode();
      result.put("ddl", ddl.trim());
      result.put("dialectId", session.dialect.id());
      return result;
    }

    ObjectNode compileObject(JsonNode params) throws SQLException {
      Session session = requireSession(params);
      String catalog = readCatalog(params);
      String schemaName = params.path("schema").asText("").trim();
      String objectName = params.path("name").asText("").trim();
      String kind = params.path("kind").asText("").trim().toLowerCase(java.util.Locale.ROOT);
      if (schemaName.isEmpty()) {
        throw new RuntimeException("Missing params.schema");
      }
      if (objectName.isEmpty()) {
        throw new RuntimeException("Missing params.name");
      }
      if (kind.isEmpty()) {
        throw new RuntimeException("Missing params.kind");
      }
      Boolean packageBody = null;
      if (params.hasNonNull("packageBody")) {
        packageBody = params.path("packageBody").asBoolean();
      }
      return session.dialect.compileObject(
          session.connection, catalog, schemaName, objectName, kind, packageBody, MAPPER);
    }

    ObjectNode listObjectDependencies(JsonNode params) throws SQLException {
      Session session = requireSession(params);
      String catalog = readCatalog(params);
      String schemaName = params.path("schema").asText("").trim();
      String objectName = params.path("name").asText("").trim();
      String kind = params.path("kind").asText("").trim().toLowerCase(java.util.Locale.ROOT);
      if (schemaName.isEmpty()) {
        throw new RuntimeException("Missing params.schema");
      }
      if (objectName.isEmpty()) {
        throw new RuntimeException("Missing params.name");
      }
      if (kind.isEmpty()) {
        throw new RuntimeException("Missing params.kind");
      }
      Boolean packageBody = null;
      if (params.hasNonNull("packageBody")) {
        packageBody = params.path("packageBody").asBoolean();
      }

      ArrayNode dependencies = MAPPER.createArrayNode();
      session.dialect.collectObjectDependencies(
          session.connection, catalog, schemaName, objectName, kind, packageBody, dependencies);

      ObjectNode result = MAPPER.createObjectNode();
      result.set("dependencies", dependencies);
      result.put("dialectId", session.dialect.id());
      return result;
    }

    ObjectNode listObjectDependents(JsonNode params) throws SQLException {
      Session session = requireSession(params);
      String catalog = readCatalog(params);
      String schemaName = params.path("schema").asText("").trim();
      String objectName = params.path("name").asText("").trim();
      String kind = params.path("kind").asText("").trim().toLowerCase(java.util.Locale.ROOT);
      if (schemaName.isEmpty()) {
        throw new RuntimeException("Missing params.schema");
      }
      if (objectName.isEmpty()) {
        throw new RuntimeException("Missing params.name");
      }
      if (kind.isEmpty()) {
        throw new RuntimeException("Missing params.kind");
      }
      Boolean packageBody = null;
      if (params.hasNonNull("packageBody")) {
        packageBody = params.path("packageBody").asBoolean();
      }

      ArrayNode dependents = MAPPER.createArrayNode();
      session.dialect.collectObjectDependents(
          session.connection, catalog, schemaName, objectName, kind, packageBody, dependents);

      ObjectNode result = MAPPER.createObjectNode();
      result.set("dependents", dependents);
      result.put("dialectId", session.dialect.id());
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
      Session session = requireSession(params);

      boolean readOnly = params.path("readOnly").asBoolean(false);
      if (readOnly && isWriteSql(sql)) {
        throw new RuntimeException(
            "Read-only mode is enabled. Write statements are blocked.");
      }

      applyConnectionSettings(session, params);

      int maxRowsOverride = params.path("maxRows").asInt(-1);
      int effectiveMaxRows = maxRowsOverride > 0 ? maxRowsOverride : maxRows;

      int timeoutOverride = params.hasNonNull("queryTimeoutSec")
          ? params.path("queryTimeoutSec").asInt(-1)
          : -1;
      // -1 → agent default; 0 → unlimited (JDBC); >0 → seconds.
      int effectiveTimeout =
          timeoutOverride >= 0 ? timeoutOverride : timeoutSeconds;


      JsonNode bindsNode = params.path("binds");
      boolean useBinds = bindsNode.isArray() && bindsNode.size() > 0;

      Statement statement =
          useBinds
              ? session.connection.prepareStatement(sql)
              : session.connection.createStatement();
      session.activeStatement = statement;
      try {
        statement.setQueryTimeout(effectiveTimeout);
        // Fetch one extra row so we can tell whether the result was truncated.
        statement.setMaxRows(effectiveMaxRows + 1);

        boolean hasResultSet;
        if (useBinds) {
          PreparedStatement prepared = (PreparedStatement) statement;
          for (int i = 0; i < bindsNode.size(); i++) {
            JsonNode bind = bindsNode.get(i);
            if (bind == null || bind.isNull()) {
              prepared.setNull(i + 1, Types.VARCHAR);
            } else {
              prepared.setString(i + 1, bind.asText());
            }
          }
          hasResultSet = prepared.execute();
        } else {
          hasResultSet = statement.execute(sql);
        }

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
        if (session.activeStatement == statement) {
          session.activeStatement = null;
        }
        try {
          statement.close();
        } catch (SQLException ignored) {
        }
      }
    }

    /**
     * Best-effort cancel of the in-flight query for {@code connectionId}. Must be callable from
     * another thread while {@code statement.execute} is blocked.
     */
    boolean cancelActiveQuery(String connectionId) {
      Session session = sessions.get(connectionId);
      if (session == null) {
        return false;
      }
      Statement statement = session.activeStatement;
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

    private static String resolveCredential(JsonNode params, String field, String envKey) {
      if (params.hasNonNull(field)) {
        return params.path(field).asText("").trim();
      }
      return optionalEnv(envKey);
    }

    private static String resolvePassword(JsonNode params) {
      if (params.has("password")) {
        return params.path("password").asText("");
      }
      return optionalEnv("SILK_DB_PASSWORD");
    }

    @Override
    public void close() {
      for (String id : List.copyOf(sessions.keySet())) {
        Session session = sessions.remove(id);
        if (session != null) {
          session.closeQuietly();
        }
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

  /**
   * Matches one leading line comment or one leading block comment, anchored at the very start of
   * the (remaining) input. {@link #stripLeadingComments} loops this to strip a whole run of
   * comments/blank lines before the real statement.
   */
  private static final Pattern LEADING_COMMENT =
      Pattern.compile("\\A\\s*(--[^\\n]*(\\n|\\z)|/\\*.*?\\*/)", Pattern.DOTALL);

  /**
   * Strips leading SQL comments/whitespace so {@link #isWriteSql} can see the real first
   * keyword — a statement like {@code "-- note\nDELETE FROM t"} must still be classified as a
   * write. This is the read-only-mode enforcement gate ({@code executeQuery}'s
   * {@code readOnly && isWriteSql(sql)} check above), so under-detecting here is a real
   * DML-bypass risk, not just a cosmetic miss.
   */
  private static String stripLeadingComments(String sql) {
    String rest = sql;
    while (true) {
      Matcher matcher = LEADING_COMMENT.matcher(rest);
      if (!matcher.find()) {
        return rest;
      }
      rest = rest.substring(matcher.end());
    }
  }

  private static boolean isWriteSql(String sql) {
    return stripLeadingComments(sql)
        .trim()
        .toLowerCase()
        .matches(
            "(?s)^(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|call|exec|execute)\\b.*");
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
