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
 *
 * <p>Every metadata-reading method below takes an explicit {@code catalog}. When {@code null} or
 * blank, dialects fall back to the connection's current catalog ({@code connection.getCatalog()})
 * — identical to the pre-catalog-parameter behavior. When non-blank, dialects that support
 * multiple catalogs (SQL Server, MySQL/MariaDB) must scope the query to that catalog *without*
 * calling {@code connection.setCatalog()} — the connection is shared across every tab/session
 * bound to this profile, so mutating its catalog as a side effect of a read would affect
 * concurrent work. Dialects with no catalog concept (Oracle) or where the driver can't switch
 * catalogs post-connect (PostgreSQL) simply ignore the parameter.
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

  /** Lists the schema/namespace names a user should be able to browse under {@code catalog}. */
  List<String> listSchemaNames(Connection connection, String catalog) throws SQLException;

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
   * {@code schemaName} (within {@code catalog}). Only kinds the database actually supports need
   * to be emitted (must be a subset of {@link #supportedGroups()}).
   *
   * <p>{@code includeSecondaryKinds} controls whether indexes/sequences/synonyms/triggers/
   * user-defined types are also collected. Each of those is its own SQL round trip on top of
   * the primary tables/views/procedures/functions query, so bulk callers that only need object
   * *names* for search (Ctrl+Shift+O prefetch, quick-pick "load" actions) pass {@code false} to
   * skip them; a single deliberate Explorer "expand this schema" click passes {@code true} for
   * the full picture.
   */
  void collectSchemaObjects(
      Connection connection,
      String catalog,
      String schemaName,
      boolean includeSecondaryKinds,
      ArrayNode objects)
      throws SQLException;

  /**
   * Populates {@code objects} with every table/view named exactly {@code name}, across every
   * schema visible within {@code catalog} (for dialects with no catalog concept, {@code catalog}
   * is ignored and every schema on the connection is searched). Each entry carries {@code
   * schemaName}/{@code name}/{@code kind} ({@code "table"} or {@code "view"}).
   *
   * <p>Backs the AI assistant's "find an object without knowing its schema" tool — deliberately
   * scoped to tables/views only (the common "open this table" case) rather than routines/
   * packages too, to keep the per-dialect query (a single {@code WHERE name = ?} against the
   * dictionary/system catalog, no schema predicate) simple and uniform across dialects. Callers
   * that need every catalog searched (SQL Server) loop {@link #listCatalogNames} and call this
   * once per catalog themselves — this method only ever looks at the one {@code catalog} given.
   */
  void findObjectsByName(
      Connection connection,
      String catalog,
      String name,
      ArrayNode objects)
      throws SQLException;

  /**
   * Populates {@code columns} with column descriptors ({@code name}, optional {@code typeName})
   * for {@code tableName} under {@code schemaName}. Used by SQL autocomplete and by the Object
   * Editor's table-structure editor (Columns tab) — implementations should also emit {@code
   * position}, {@code autoIncrement}, and {@code generated} when the driver exposes them (see
   * {@link MetadataColumns#appendFromResultSet}), since the structure editor uses them to keep
   * identity/generated columns read-only and to order the grid deterministically. Dialects whose
   * type system can't be losslessly reconstructed from {@code typeName}/{@code columnSize}/{@code
   * decimalDigits} alone (MySQL/MariaDB's {@code ENUM(...)}/{@code SET(...)}/unsigned modifiers)
   * should additionally populate {@code fullTypeName} with the driver's own full column-type text
   * — the structure editor's MySQL rename path (which must restate the entire column definition)
   * depends on it.
   */
  void collectTableColumns(
      Connection connection,
      String catalog,
      String schemaName,
      String tableName,
      ArrayNode columns)
      throws SQLException;

  /**
   * Populates {@code indexes} with index descriptors ({@code name}, {@code unique}, {@code
   * columns}) for {@code tableName}. Object Editor "Indexes" section.
   */
  void collectTableIndexes(
      Connection connection,
      String catalog,
      String schemaName,
      String tableName,
      ArrayNode indexes)
      throws SQLException;

  /**
   * Populates {@code foreignKeys} with foreign-key descriptors for {@code tableName} as the
   * referencing (child) side. Object Editor "Foreign Keys" section.
   */
  void collectTableForeignKeys(
      Connection connection,
      String catalog,
      String schemaName,
      String tableName,
      ArrayNode foreignKeys)
      throws SQLException;

  /**
   * Populates {@code arguments} with parameter descriptors ({@code name}, {@code typeName},
   * {@code direction}: in/out/inout/return, {@code position}) for a standalone stored
   * {@code routineName} — {@code kind} is {@code "procedure"} or {@code "function"} and picks
   * which JDBC metadata call applies (they're separate methods with different result shapes).
   * Object Editor "Arguments" section. Package members are out of scope — a package's own
   * procedures/functions aren't independently addressable by this method.
   */
  void collectRoutineArguments(
      Connection connection,
      String catalog,
      String schemaName,
      String routineName,
      String kind,
      ArrayNode arguments)
      throws SQLException;

  /**
   * Populates {@code constraints} with primary-key/unique/check constraint descriptors for
   * {@code tableName}. Object Editor "Constraints" section.
   */
  void collectTableConstraints(
      Connection connection,
      String catalog,
      String schemaName,
      String tableName,
      ArrayNode constraints)
      throws SQLException;

  /**
   * Populates {@code triggers} with trigger descriptors for {@code tableName}. Object Editor
   * "Triggers" section.
   */
  void collectTableTriggers(
      Connection connection,
      String catalog,
      String schemaName,
      String tableName,
      ArrayNode triggers)
      throws SQLException;

  /**
   * Returns the table/view-level comment (description), or {@code null} when the object has
   * none. Object Editor "General" section. Default: unsupported (no comment concept exposed by
   * this dialect's driver).
   */
  default String fetchTableComment(
      Connection connection, String catalog, String schemaName, String tableName)
      throws SQLException {
    return null;
  }

  /**
   * Populates {@code references} with descriptors for foreign keys that *other* tables hold
   * pointing at {@code tableName} — the mirror image of {@link #collectTableForeignKeys}. Object
   * Editor "References" section.
   */
  void collectTableReferences(
      Connection connection,
      String catalog,
      String schemaName,
      String tableName,
      ArrayNode references)
      throws SQLException;

  /**
   * Populates {@code members} with package procedure/function descriptors ({@code name}, {@code
   * kind}) for SQL autocomplete ({@code PKG.member}). Default: no members (non-Oracle dialects).
   */
  default void collectPackageMembers(
      Connection connection,
      String catalog,
      String schemaName,
      String packageName,
      ArrayNode members)
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
      Connection connection,
      String catalog,
      String schemaName,
      String tableName,
      ArrayNode keys)
      throws SQLException;

  /**
   * Resolves whether {@code tableName} is a {@code table}, {@code view}, or {@code
   * materializedView} for safe cell-update messaging. Default: JDBC {@code getTables}.
   *
   * @return kind string, or {@code null} when unknown / not found
   */
  default String resolveRelationKind(
      Connection connection, String catalog, String schemaName, String tableName)
      throws SQLException {
    return MetadataRelationKind.resolveViaJdbc(connection, catalog, schemaName, tableName);
  }

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
      String catalog,
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
      String catalog,
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
      String catalog,
      String schemaName,
      String objectName,
      String kind,
      Boolean packageBody,
      ArrayNode dependencies)
      throws SQLException {
    // no-op
  }

  /**
   * Populates {@code dependents} with objects that reference this one (the reverse of {@link
   * #collectObjectDependencies}). Default: no dependents (non-supporting dialects).
   *
   * <p>{@code packageBody} is only meaningful for {@code kind=package}:
   * {@code true} → body, {@code false} → spec, {@code null} → both spec and body.
   */
  default void collectObjectDependents(
      Connection connection,
      String catalog,
      String schemaName,
      String objectName,
      String kind,
      Boolean packageBody,
      ArrayNode dependents)
      throws SQLException {
    // no-op
  }

  /**
   * Quotes {@code raw} as a delimited identifier in this dialect's own syntax (double quotes for
   * Oracle/PostgreSQL, backticks for MySQL/MariaDB, brackets for SQL Server), including the
   * wrapping delimiters — e.g. Oracle's {@code COL} becomes {@code "COL"}. Used to safely embed
   * caller-supplied column names (already validated against the result's own column list by the
   * caller) into generated WHERE/ORDER BY fragments for {@link #wrapPagedQuery}.
   */
  String quoteIdentifier(String raw);

  /**
   * Wraps an arbitrary caller-supplied {@code SELECT} statement ({@code innerSql}, executed
   * as-is, unmodified) as a derived table and applies an optional filter, optional sort, and
   * mandatory offset/limit pagination, in this dialect's own syntax. Backs the large-result
   * scroll/filter feature (5-D v2): the frontend re-issues the *original* query text with a page
   * window (and, once implemented, a translated AG-Grid filter/sort) rather than the agent
   * tracking any server-side cursor state between calls.
   *
   * <p>{@code whereFragment}/{@code orderByFragment} are fully-formed SQL text (identifiers
   * already quoted via {@link #quoteIdentifier}, value placeholders already {@code ?}) with no
   * leading {@code WHERE}/{@code ORDER BY} keyword — pass {@code null} or blank to omit the
   * clause entirely. Implementations that require an ORDER BY for pagination syntax to be valid
   * (SQL Server) must supply their own deterministic fallback when {@code orderByFragment} is
   * absent, since the caller does not guarantee one.
   */
  String wrapPagedQuery(
      String innerSql, String whereFragment, String orderByFragment, int offset, int limit);

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
