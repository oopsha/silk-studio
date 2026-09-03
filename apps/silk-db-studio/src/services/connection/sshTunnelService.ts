import { bridgeSshTunnelClose, bridgeSshTunnelOpen } from "./sshTunnelBridge";
import { hasSshSecretAnswer, sshSecretGet, type SshSecretKind } from "./sshTunnelSecretBridge";
import { buildJdbcUrl, parseJdbcUrl } from "./connectionUrlBuilder";
import type { ConnectionDriverId } from "./connectionTypes";
import type { SshTunnelConfig, SshTunnelProgress } from "./sshTunnelTypes";

export type { SshTunnelProgress } from "./sshTunnelTypes";

/**
 * Which SSH secrets this tunnel config needs but doesn't have stored — most commonly right
 * after importing a connection profile, which never carries secrets (see
 * `connectionExportService.ts`). Drives the pre-flight `SshSecretPromptService` prompt in
 * `connectionService.ts`, mirroring the DB password's own missing-secret prompt.
 */
export async function resolveMissingSshSecretFields(
  connectionId: string,
  tunnel: SshTunnelConfig,
): Promise<SshSecretKind[]> {
  const missing: SshSecretKind[] = [];
  const mainKind: SshSecretKind = tunnel.authMethod === "password" ? "password" : "passphrase";
  if (!(await hasSshSecretAnswer(connectionId, mainKind))) {
    missing.push(mainKind);
  }
  if (tunnel.secondHop.enabled) {
    const hopKind: SshSecretKind =
      tunnel.secondHop.authMethod === "password" ? "targetPassword" : "targetPassphrase";
    if (!(await hasSshSecretAnswer(connectionId, hopKind))) {
      missing.push(hopKind);
    }
  }
  return missing;
}

/**
 * Opens the SSH tunnel for `connectionId`, targeting the host/port already encoded in the
 * profile's own `url` (same convention as `openSsmTunnelForConnect`). Returns a rewritten JDBC
 * URL pointing at the local tunnel port — `url` itself is never mutated; the caller must use
 * this returned string only for the connect call.
 */
export async function openSshTunnelForConnect(
  connectionId: string,
  driverId: ConnectionDriverId,
  url: string,
  tunnel: SshTunnelConfig,
  onProgress?: SshTunnelProgress,
  /**
   * Secrets the user just typed into `SshSecretPromptService`'s dialog for this connect attempt,
   * keyed by the same `SshSecretKind` used in the keyring. Takes priority over the stored
   * secret so an unsaved ("don't save this credential") entry still works for this one attempt.
   */
  secretOverrides?: Partial<Record<SshSecretKind, string>>,
): Promise<string> {
  const parsed = parseJdbcUrl(driverId, url);
  if (!parsed || !parsed.host) {
    throw new Error(
      "This connection's URL can't be tunneled — switch to Host/Port/Database mode first.",
    );
  }
  const remotePort = Number(parsed.port);
  if (!Number.isFinite(remotePort) || remotePort <= 0) {
    throw new Error("This connection has no valid port to tunnel to.");
  }

  const password =
    tunnel.authMethod === "password"
      ? (secretOverrides?.password ?? (await sshSecretGet(connectionId, "password")))
      : undefined;
  const passphrase =
    tunnel.authMethod === "privateKey"
      ? (secretOverrides?.passphrase ?? (await sshSecretGet(connectionId, "passphrase")))
      : undefined;

  const secondHopConfig = tunnel.secondHop.enabled ? tunnel.secondHop : undefined;
  const secondHop = secondHopConfig
    ? {
        targetHost: secondHopConfig.host,
        targetPort: Number(secondHopConfig.port) || 22,
        targetUsername: secondHopConfig.username,
        targetAuthMethod: secondHopConfig.authMethod,
        targetPassword:
          secondHopConfig.authMethod === "password"
            ? (secretOverrides?.targetPassword ??
                (await sshSecretGet(connectionId, "targetPassword"))) || undefined
            : undefined,
        targetPrivateKeyPath: secondHopConfig.privateKeyPath,
        targetPassphrase:
          secondHopConfig.authMethod === "privateKey"
            ? (secretOverrides?.targetPassphrase ??
                (await sshSecretGet(connectionId, "targetPassphrase"))) || undefined
            : undefined,
      }
    : undefined;

  onProgress?.({ phase: "startingTunnel" });
  const result = await bridgeSshTunnelOpen(
    connectionId,
    tunnel.host,
    Number(tunnel.port) || 22,
    tunnel.username,
    tunnel.authMethod,
    password || undefined,
    tunnel.privateKeyPath,
    passphrase || undefined,
    secondHop,
    parsed.host,
    remotePort,
  );
  return buildJdbcUrl(driverId, {
    ...parsed,
    host: "127.0.0.1",
    port: String(result.localPort),
  });
}

export async function closeSshTunnel(connectionId: string): Promise<void> {
  await bridgeSshTunnelClose(connectionId);
}
