import { invoke } from "@tauri-apps/api/core";
import { tKey } from "@silk-studio/workbench/platform/i18n/activeLocale.ts";
import { formatErrorMessage } from "../formatErrorMessage";

/**
 * Exact substring of the exception `Main.java`'s `requireSession` throws when the jdbc-agent
 * has no live JDBC session for a connectionId (session map entry missing, or its `Connection`
 * is null/closed) — e.g. because the underlying tunnel/socket died from an idle timeout, or the
 * jdbc-agent process itself restarted. Kept isolated so the match logic is easy to extend if the
 * backend message ever changes.
 */
const STALE_SESSION_MARKER = "Connection is not open";

/** True when `error` looks like jdbc-agent's "no live session for this connectionId" exception. */
export function isStaleSessionError(error: unknown): boolean {
  return formatErrorMessage(error, "").includes(STALE_SESSION_MARKER);
}

/**
 * Exact substring of the error `silk-db-agent-client`'s `ensure_connection` (Rust) returns when
 * this connectionId was never opened at all (as opposed to `STALE_SESSION_MARKER`, where it was
 * opened and later dropped) — this is a Rust-side string, never routed through the i18n system,
 * so it always shows up untranslated unless intercepted here.
 */
const NO_ACTIVE_CONNECTION_MARKER = "No active database connection (";

function isNoActiveConnectionError(error: unknown): boolean {
  return formatErrorMessage(error, "").includes(NO_ACTIVE_CONNECTION_MARKER);
}

/**
 * Invokes a JDBC-session-scoped Tauri command, transparently self-healing the common case where
 * the frontend still believes `connectionId` is connected (see `ConnectionService`'s
 * `connectedProfileIds`) but the backend's in-memory JDBC session for it is actually gone —
 * e.g. after an idle-timeout tunnel drop. `requireSession` runs before any SQL/metadata work in
 * every jdbc-agent RPC handler, so retrying after a successful reconnect never risks
 * double-executing a write.
 *
 * On a stale-session error: attempts exactly one silent reconnect via
 * `ConnectionService.connect(connectionId, { silent: true, promptForPassword: false })`, then
 * retries the original invoke exactly once. Any other error (auth failure, SQL error, network
 * error unrelated to session staleness, or a second failure after reconnect) is rethrown as-is —
 * no further retries, no backoff.
 */
export async function invokeJdbcCommand<T>(
  command: string,
  args: Record<string, unknown>,
  connectionId: string,
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    if (isNoActiveConnectionError(error)) {
      throw new Error(tKey("app.query.noConnection"));
    }
    if (!isStaleSessionError(error)) {
      throw error;
    }

    // Lazy import breaks the connectionService <-> jdbcInvoke <-> connectionBridge cycle
    // (connectionService.ts imports connectionBridge.ts at module scope; several bridge
    // functions import invokeJdbcCommand from here) — same pattern as
    // connectionTransactionService.ts's rollbackConnection and
    // resolveExecutionConnection.ts's ensureExecutionConnection.
    const { ConnectionService } = await import("./connectionService");

    try {
      await ConnectionService.connect(connectionId, {
        silent: true,
        promptForPassword: false,
      });
    } catch {
      // Fall through to the isConnected check below, which throws a clear error.
    }

    if (!ConnectionService.isConnected(connectionId)) {
      const profile = ConnectionService.getProfile(connectionId);
      throw new Error(
        tKey("app.query.connectionReconnectFailed").replace(
          "{name}",
          profile?.name ?? connectionId,
        ),
      );
    }

    return await invoke<T>(command, args);
  }
}
