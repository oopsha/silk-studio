package com.silk.jdbcagent;

import java.time.Instant;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicLong;

/** Small, value-free timing diagnostics for slow JDBC requests. */
final class JdbcDiagnostics {
  private static final long SLOW_OPERATION_NANOS = 250_000_000L;
  private static final AtomicLong REQUEST_SEQUENCE = new AtomicLong();
  private static final ThreadLocal<Long> CURRENT_REQUEST = new ThreadLocal<>();

  private JdbcDiagnostics() {}

  static long nextRequestId() {
    return REQUEST_SEQUENCE.incrementAndGet();
  }

  static void setCurrentRequest(long requestId) {
    CURRENT_REQUEST.set(requestId);
  }

  static void clearCurrentRequest() {
    CURRENT_REQUEST.remove();
  }

  static void logSlowRequest(
      long requestId, String method, long queuedAtNanos, long startedAtNanos,
      long finishedAtNanos, boolean success) {
    long queueMs = millis(startedAtNanos - queuedAtNanos);
    long executionMs = millis(finishedAtNanos - startedAtNanos);
    if (queueMs < 250 && executionMs < 250) return;
    write(String.format(
        Locale.ROOT,
        "request=%d stage=rpc method=%s queueMs=%d executionMs=%d outcome=%s",
        requestId, safeToken(method), queueMs, executionMs, success ? "ok" : "error"));
  }

  static void logSlowOperation(String stage, long startedAtNanos, String details) {
    long durationMs = millis(System.nanoTime() - startedAtNanos);
    if (durationMs < 250) return;
    Long requestId = CURRENT_REQUEST.get();
    String request = requestId == null ? "request=none" : "request=" + requestId;
    String suffix = details == null || details.isBlank() ? "" : " " + details;
    write(String.format(
        Locale.ROOT, "%s stage=%s durationMs=%d%s", request, safeToken(stage), durationMs, suffix));
  }

  static long millis(long nanos) {
    return Math.max(0L, nanos / 1_000_000L);
  }

  private static String safeToken(String value) {
    return value.replaceAll("[^A-Za-z0-9_.-]", "_");
  }

  private static void write(String message) {
    synchronized (JdbcDiagnostics.class) {
      System.err.printf("[%s] [jdbc-timing] %s%n", Instant.now(), message);
    }
  }
}
