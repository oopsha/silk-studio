package com.silk.jdbcagent;

/**
 * Stable Explorer object-group ids shared with the frontend's {@code MetadataGroupId} type in
 * {@code @silk-studio/db-protocol}. A {@link DbDialect} declares which of these it supports via
 * {@link DbDialect#supportedGroups()}; {@link Main} uses that to partition the flat object list
 * from {@link DbDialect#collectSchemaObjects} into the {@code groups} array returned to the
 * frontend, so databases with no concept of e.g. Oracle's PACKAGE never emit that group.
 *
 * <p>Display label/icon for each id live in the frontend registry
 * ({@code services/connection/metadataGroups.ts}), not here — this enum only carries the wire id
 * and the object {@code kind} string (e.g. {@code "table"}, {@code "package"}) it buckets.
 */
enum MetadataGroupId {
  TABLES("tables", "table"),
  VIEWS("views", "view"),
  PACKAGES("packages", "package"),
  PROCEDURES("procedures", "procedure"),
  FUNCTIONS("functions", "function");

  /** Value sent over the wire as {@code group.id}; must match the frontend's MetadataGroupId. */
  final String id;
  /** The {@code object.kind} value this group buckets (see {@link Main#populateGroups}). */
  final String kind;

  MetadataGroupId(String id, String kind) {
    this.id = id;
    this.kind = kind;
  }

  static MetadataGroupId forKind(String kind) {
    for (MetadataGroupId group : values()) {
      if (group.kind.equalsIgnoreCase(kind)) {
        return group;
      }
    }
    return null;
  }
}
