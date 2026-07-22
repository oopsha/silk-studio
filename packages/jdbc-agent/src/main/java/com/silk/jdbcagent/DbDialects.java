package com.silk.jdbcagent;

import java.util.List;
import java.util.Locale;

/** Registry that maps a JDBC URL to the {@link DbDialect} that should handle it. */
final class DbDialects {
  private static final List<DbDialect> ALL =
      List.of(new OracleDialect(), new SqlServerDialect(), new MySqlDialect());

  private DbDialects() {}

  static DbDialect forUrl(String url) {
    if (url == null || url.isBlank()) {
      throw new RuntimeException("Missing JDBC URL.");
    }
    String normalized = url.trim().toLowerCase(Locale.ROOT);
    for (DbDialect dialect : ALL) {
      if (dialect.matchesUrl(normalized)) {
        return dialect;
      }
    }
    throw new RuntimeException(
        "Unsupported JDBC URL. Supported prefixes: jdbc:oracle:, jdbc:sqlserver:, jdbc:mysql:");
  }
}
