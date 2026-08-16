import { bridgeSshTunnelClose, bridgeSshTunnelOpen } from "./sshTunnelBridge";
import { sshSecretGet } from "./sshTunnelSecretBridge";
import { buildJdbcUrl, parseJdbcUrl } from "./connectionUrlBuilder";
import type { ConnectionDriverId } from "./connectionTypes";
import type { SshTunnelConfig, SshTunnelProgress } from "./sshTunnelTypes";

export type { SshTunnelProgress } from "./sshTunnelTypes";

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
    tunnel.authMethod === "password" ? await sshSecretGet(connectionId, "password") : undefined;
  const passphrase =
    tunnel.authMethod === "privateKey" ? await sshSecretGet(connectionId, "passphrase") : undefined;

  const secondHopConfig = tunnel.secondHop.enabled ? tunnel.secondHop : undefined;
  const secondHop = secondHopConfig
    ? {
        targetHost: secondHopConfig.host,
        targetPort: Number(secondHopConfig.port) || 22,
        targetUsername: secondHopConfig.username,
        targetAuthMethod: secondHopConfig.authMethod,
        targetPassword:
          secondHopConfig.authMethod === "password"
            ? (await sshSecretGet(connectionId, "targetPassword")) || undefined
            : undefined,
        targetPrivateKeyPath: secondHopConfig.privateKeyPath,
        targetPassphrase:
          secondHopConfig.authMethod === "privateKey"
            ? (await sshSecretGet(connectionId, "targetPassphrase")) || undefined
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
