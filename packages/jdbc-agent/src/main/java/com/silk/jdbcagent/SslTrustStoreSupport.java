package com.silk.jdbcagent;

/**
 * On Windows, makes outbound TLS connections (Oracle TCPS in particular — the driver that
 * prompted this) trust whatever roots are in the OS's own "Trusted Root Certification
 * Authorities" store, by pointing the JVM's default trust store type at it.
 *
 * <p>Why this exists: a corporate TLS-inspecting network appliance (observed: a "Somansa Root
 * CA" DLP proxy) re-signs outbound TLS connections with its own root certificate. That root is
 * typically pushed into Windows' system trust store by IT policy, but is obviously not part of
 * any public CA bundle — so it's absent from the Temurin JRE's {@code cacerts} that Silk bundles,
 * and Oracle JDBC's TCPS handshake fails with a PKIX path-building error even though the same
 * connection works fine in tools that consult the OS trust store.
 *
 * <p>Confirmed by reading DBeaver's source (which handles this exact scenario) and by directly
 * probing the real failing connection: an OS-agnostic approach that builds a custom merged
 * {@code X509TrustManager} and installs it via {@code SSLContext.setDefault(...)} does NOT work
 * here — Oracle's thin driver (`oracle.net.nt.SSLSocketChannel`) builds its own private {@code
 * SSLContext} for the TCPS handshake rather than consulting {@code SSLContext.getDefault()}, so
 * a custom default SSLContext is silently never used. What DBeaver actually does, and what this
 * mirrors exactly (`GeneralUtils.PROP_TRUST_STORE_TYPE`/`VALUE_TRUST_STORE_TYPE_WINDOWS` in
 * DBeaver's source, set once at startup): setting the {@code javax.net.ssl.trustStoreType}
 * system property to {@code Windows-ROOT} *before* anything creates a trust manager. Any code
 * that asks for "the default trust manager" — including Oracle's own private SSLContext setup —
 * resolves the default keystore type from this system property, so it reaches every driver
 * uniformly without needing to intercept each one's SSL setup individually.
 *
 * <p>This is a straight swap, not a merge with the bundled {@code cacerts}: Windows' own root
 * store already carries the standard public CAs (Windows Update keeps it current) in addition to
 * whatever an organization's IT policy adds, so it's a safe superset for the normal case too —
 * exactly what DBeaver relies on cross a huge user base already.
 */
final class SslTrustStoreSupport {
  private SslTrustStoreSupport() {}

  private static final String TRUST_STORE_PROPERTY = "javax.net.ssl.trustStore";
  private static final String TRUST_STORE_TYPE_PROPERTY = "javax.net.ssl.trustStoreType";
  private static final String WINDOWS_ROOT = "Windows-ROOT";

  /**
   * Best-effort; never throws. Safe to call unconditionally at process startup, before any TLS
   * connection is made. A no-op on non-Windows platforms, and a no-op if the trust store type or
   * location was already explicitly configured (e.g. via `-D` flags), so it never clobbers a
   * deliberate advanced setup.
   */
  static void installWindowsRootTrustIfApplicable() {
    if (!isWindows()) {
      return;
    }
    if (!isBlank(System.getProperty(TRUST_STORE_PROPERTY))
        || !isBlank(System.getProperty(TRUST_STORE_TYPE_PROPERTY))) {
      return;
    }
    System.setProperty(TRUST_STORE_TYPE_PROPERTY, WINDOWS_ROOT);
  }

  private static boolean isBlank(String value) {
    return value == null || value.isBlank();
  }

  private static boolean isWindows() {
    String osName = System.getProperty("os.name", "");
    return osName.toLowerCase(java.util.Locale.ROOT).contains("windows");
  }
}
