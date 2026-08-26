package com.silk.jdbcagent;

/**
 * Builds a safe {@code LIKE '%...%'} substring-match pattern from a raw, user-supplied search
 * term. Every dialect's {@link DbDialect#findObjectsByName} substring mode uses this so a term
 * containing {@code %} or {@code _} (both {@code LIKE} wildcards) is matched literally rather than
 * as a wildcard — the escape character itself is escaped first, then each wildcard character is
 * prefixed with it, and the whole thing is wrapped in {@code %...%}. Every dialect's substring
 * query pairs the returned pattern with an {@code ESCAPE '\'} clause using this same backslash
 * escape character.
 */
final class LikeEscape {
  private LikeEscape() {}

  static final char ESCAPE_CHAR = '\\';

  /** Returns {@code "%" + escaped(term) + "%"}, safe to bind as a {@code LIKE ... ESCAPE '\'} pattern. */
  static String containsPattern(String term) {
    StringBuilder escaped = new StringBuilder(term.length() + 8);
    for (int i = 0; i < term.length(); i++) {
      char c = term.charAt(i);
      if (c == ESCAPE_CHAR || c == '%' || c == '_') {
        escaped.append(ESCAPE_CHAR);
      }
      escaped.append(c);
    }
    return "%" + escaped + "%";
  }
}
