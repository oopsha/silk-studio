package com.silk.jdbcagent;

import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;

/**
 * Shared helper for {@link DbDialect#collectTableTriggers}. No JDBC metadata call covers
 * triggers, so each dialect runs its own SQL — but must project rows shaped as {@code NAME,
 * TIMING (nullable), EVENT (nullable), ENABLED (nullable, already normalized to this
 * database's "is active" polarity)} — and this groups those flat per-event rows into one JSON
 * object per trigger.
 */
final class MetadataTriggers {
  private MetadataTriggers() {}

  private static final class TriggerBuilder {
    String timing;
    Boolean enabled;
    final Set<String> events = new LinkedHashSet<>();
  }

  static void appendFromResultSet(ResultSet rs, ArrayNode triggers) throws SQLException {
    Map<String, TriggerBuilder> byName = new LinkedHashMap<>();
    while (rs.next()) {
      String name = rs.getString("NAME");
      if (name == null || name.isBlank()) {
        continue;
      }
      TriggerBuilder builder = byName.computeIfAbsent(name, key -> new TriggerBuilder());
      String timing = rs.getString("TIMING");
      if (timing != null && !timing.isBlank()) {
        builder.timing = timing.trim();
      }
      String event = rs.getString("EVENT");
      if (event != null && !event.isBlank()) {
        builder.events.add(event.trim());
      }
      Object enabledValue = rs.getObject("ENABLED");
      if (enabledValue != null) {
        builder.enabled = coerceEnabled(enabledValue);
      }
    }
    for (Map.Entry<String, TriggerBuilder> entry : byName.entrySet()) {
      TriggerBuilder builder = entry.getValue();
      ObjectNode trigger = triggers.addObject();
      trigger.put("name", entry.getKey());
      if (builder.timing != null) {
        trigger.put("timing", builder.timing);
      }
      if (!builder.events.isEmpty()) {
        trigger.put("event", String.join(", ", builder.events));
      }
      if (builder.enabled != null) {
        trigger.put("enabled", builder.enabled);
      }
    }
  }

  private static boolean coerceEnabled(Object value) {
    if (value instanceof Boolean bool) {
      return bool;
    }
    String text = value.toString().trim();
    return !("N".equalsIgnoreCase(text)
        || "DISABLED".equalsIgnoreCase(text)
        || "0".equals(text)
        || "false".equalsIgnoreCase(text));
  }
}
