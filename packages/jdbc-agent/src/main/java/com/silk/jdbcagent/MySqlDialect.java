package com.silk.jdbcagent;

/**
 * Official MySQL Connector/J dialect. MySQL has no schema concept distinct from the database
 * (catalog) — {@code CREATE SCHEMA} is a synonym for {@code CREATE DATABASE} — so each database
 * the user can see is surfaced as one browsable "schema" node, matching the multi-jdbc-rollout
 * plan's "database를 catalog/기본 namespace로 사용" requirement. The frontend keeps `catalog` and
 * `defaultSchema` in sync for this driver (see {@code ConnectionDriverDefinition.showSchemaField}
 * in connectionTypes.ts) so this dialect only needs to care about `catalog`.
 *
 * <p>Shared logic with {@link MariaDbDialect} lives in {@link MySqlCompatibleDialect}.
 */
final class MySqlDialect extends MySqlCompatibleDialect {
  @Override
  public String id() {
    return "mysql";
  }

  @Override
  public boolean matchesUrl(String normalizedUrl) {
    return normalizedUrl.startsWith("jdbc:mysql:");
  }
}
