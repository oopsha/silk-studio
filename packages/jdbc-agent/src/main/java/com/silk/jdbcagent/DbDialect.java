package com.silk.jdbcagent;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.List;

/**
 * Encapsulates the per-database differences that {@link Main.AgentRuntime} would otherwise have
 * to special-case: connection test query, applying a default catalog/schema after connecting, and
 * discovering schemas/objects via {@link java.sql.DatabaseMetaData}.
 *
 * <p>Add a new implementation + register it in {@link DbDialects} to support another database;
 * the rest of the agent (request handling, JSON shapes) stays untouched.
 */
interface DbDialect {
  /** Stable id surfaced in error messages; matches the frontend's {@code ConnectionDriverId}. */
  String id();

  /** Whether this dialect handles the given (already trimmed, lower-cased) JDBC URL. */
  boolean matchesUrl(String normalizedUrl);

  /** Runs a cheap round-trip query to verify the connection actually works. */
  void testConnection(Connection connection, int timeoutSeconds) throws SQLException;

  /**
   * Applies profile-level defaults (catalog/database, default schema) right after the physical
   * JDBC connection is established. {@code params} is the raw {@code connection.open} request.
   */
  void afterConnect(Connection connection, JsonNode params) throws SQLException;

  /** Lists the schema/namespace names a user should be able to browse. */
  List<String> listSchemaNames(Connection connection) throws SQLException;

  /**
   * When {@code true}, Explorer shows a Databases (catalog) level above schemas (SQL Server).
   * Dialects that fold catalogs into the schema list (MySQL) or have no catalogs (Oracle) return
   * {@code false}.
   */
  default boolean usesCatalogExplorer() {
    return false;
  }

  /**
   * Lists catalog/database names for {@link #usesCatalogExplorer()} dialects. Default: empty.
   */
  default List<String> listCatalogNames(Connection connection) throws SQLException {
    return List.of();
  }

  /**
   * Populates {@code objects} with the tables/views/procedures/functions/packages visible under
   * {@code schemaName}. Only kinds the database actually supports need to be emitted (must be a
   * subset of {@link #supportedGroups()}).
   */
  void collectSchemaObjects(Connection connection, String schemaName, ArrayNode objects)
      throws SQLException;

  /**
   * Populates {@code columns} with column descriptors ({@code name}, optional {@code typeName})
   * for {@code tableName} under {@code schemaName}. Used by SQL autocomplete.
   */
  void collectTableColumns(
      Connection connection, String schemaName, String tableName, ArrayNode columns)
      throws SQLException;

  /**
   * Populates {@code members} with package procedure/function descriptors ({@code name}, {@code
   * kind}) for SQL autocomplete ({@code PKG.member}). Default: no members (non-Oracle dialects).
   */
  default void collectPackageMembers(
      Connection connection, String schemaName, String packageName, ArrayNode members)
      throws SQLException {
    // no-op
  }

  /**
   * Populates {@code keys} with primary-key column names ({@code name}) for {@code tableName}.
   * When {@code schemaName} is blank, resolves the owner from JDBC session context (same rules
   * as unqualified {@code SELECT}).
   *
   * @return resolved schema/owner, or {@code null} when no PK metadata was found
   */
  String collectPrimaryKeys(
      Connection connection, String schemaName, String tableName, ArrayNode keys)
      throws SQLException;

  /**
   * Which Explorer object groups this database has a concept of, in display order. {@link Main}
   * partitions {@link #collectSchemaObjects}'s flat object list into exactly these groups —
   * databases with no PACKAGE concept (SQL Server, MySQL, ...) must omit
   * {@link MetadataGroupId#PACKAGES} here so the Explorer never shows an empty "Packages" group
   * for them.
   */
  List<MetadataGroupId> supportedGroups();

  /**
   * Returns the DDL/source text for a database object, or {@code null} when not found.
   *
   * <p>{@code packageBody} is only meaningful for {@code kind=package} (Oracle PACKAGE BODY).
   */
  String fetchObjectDdl(
      Connection connection,
      String schemaName,
      String objectName,
      String kind,
      Boolean packageBody)
      throws SQLException;

  /**
   * Recompiles a stored PL/SQL (or equivalent) object and returns compile diagnostics.
   * Default: unsupported.
   *
   * <p>{@code packageBody} is only meaningful for {@code kind=package}:
   * {@code true} → body, {@code false} → spec, {@code null} → both.
   *
   * @return JSON object with {@code success}, {@code dialectId}, {@code errors[]}
   */
  default com.fasterxml.jackson.databind.node.ObjectNode compileObject(
      Connection connection,
      String schemaName,
      String objectName,
      String kind,
      Boolean packageBody,
      com.fasterxml.jackson.databind.ObjectMapper mapper)
      throws SQLException {
    throw new RuntimeException("Compile is not supported for " + id() + ".");
  }

  /**
   * Populates {@code dependencies} with compile-time references for a stored object.
   * Default: no dependencies (non-supporting dialects).
   *
   * <p>{@code packageBody} is only meaningful for {@code kind=package}:
   * {@code true} → body, {@code false} → spec, {@code null} → both spec and body.
   */
  default void collectObjectDependencies(
      Connection connection,
      String schemaName,
      String objectName,
      String kind,
      Boolean packageBody,
      ArrayNode dependencies)
      throws SQLException {
    // no-op
  }

  /** Shared helper: run {@code testSql} with a timeout and require at least one row back. */
  default void runTestQuery(Connection connection, int timeoutSeconds, String testSql)
      throws SQLException {
    try (Statement statement = connection.createStatement()) {
      statement.setQueryTimeout(timeoutSeconds);
      try (var rs = statement.executeQuery(testSql)) {
        if (!rs.next()) {
          throw new RuntimeException("Connection test query returned no rows.");
        }
      }
    }
  }
}
