package com.silk.jdbcagent;

import java.util.regex.Pattern;

/**
 * Helpers for scoping a metadata query to an explicit catalog/database without switching the
 * shared JDBC {@code Connection}'s current catalog (which would affect every other session
 * sharing that connection). SQL Server allows 3-part {@code [catalog].sys.objects}-style
 * references inside a single statement; this builds that prefix safely.
 */
final class CatalogQualifier {
  private CatalogQualifier() {}

  /**
   * Catalog/database names may contain letters (any script), digits, spaces, and a small set of
   * punctuation. This is not exhaustive SQL Server identifier syntax — it's a conservative
   * allowlist so a rejected value fails closed rather than being interpolated into raw SQL.
   */
  private static final Pattern SAFE_CATALOG_NAME =
      Pattern.compile("^[\\p{L}\\p{N}_ .$#@-]+$");

  /**
   * Validates a caller-supplied catalog name before it's interpolated into SQL text (it can't be
   * a JDBC bind parameter in this position). Throws when the value contains anything outside the
   * safe set — e.g. quotes, brackets, semicolons, comments.
   */
  static void requireSafe(String catalog) {
    if (catalog == null || catalog.isBlank()) {
      return;
    }
    if (!SAFE_CATALOG_NAME.matcher(catalog).matches()) {
      throw new RuntimeException("Invalid catalog name: " + catalog);
    }
  }

  /** Returns {@code "[catalog]."} (bracket-escaped) or {@code ""} when catalog is null/blank. */
  static String prefix(String catalog) {
    if (catalog == null || catalog.isBlank()) {
      return "";
    }
    return "[" + catalog.trim().replace("]", "]]") + "].";
  }
}
