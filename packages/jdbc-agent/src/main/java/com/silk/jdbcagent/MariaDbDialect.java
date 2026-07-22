package com.silk.jdbcagent;

/**
 * Official MariaDB Connector/J dialect. Bundled as its own driver (org.mariadb.jdbc) and
 * frontend driver id ({@code "mariadb"}), distinct from {@link MySqlDialect} — see
 * THIRD_PARTY_NOTICES.md for its license (LGPL-2.1-or-later, vs. MySQL Connector/J's
 * GPLv2+FOSS-exception).
 *
 * <p>MariaDB Connector/J only accepts the {@code jdbc:mariadb:} URL scheme by default (the
 * {@code jdbc:mysql:} scheme requires an explicit {@code permitMysqlScheme} option, which this
 * app never sets), so it can never shadow mysql-connector-j's registration for {@code
 * jdbc:mysql:} URLs even though both drivers are on the same classpath.
 *
 * <p>Like MySQL, MariaDB has no schema concept distinct from the database/catalog and no
 * PACKAGE concept — shared logic lives in {@link MySqlCompatibleDialect}.
 */
final class MariaDbDialect extends MySqlCompatibleDialect {
  @Override
  public String id() {
    return "mariadb";
  }

  @Override
  public boolean matchesUrl(String normalizedUrl) {
    return normalizedUrl.startsWith("jdbc:mariadb:");
  }
}
