/**
 * Optional SSH jump-host (bastion) tunnel layer for a connection profile. When enabled, the
 * connect flow opens a local port-forward through `host`/`port` (the jump host itself) before
 * the JDBC connect, using the profile's own Host/Port (from `ConnectionProfile.url`) as the
 * tunnel's remote target — same convention as `SsmTunnelConfig`.
 *
 * Mutually exclusive with `SsmTunnelConfig` on the same profile — see `connectionService.ts`.
 */
export type SshAuthMethod = "password" | "privateKey";

export type SshTunnelConfig = {
  enabled: boolean;
  /** The jump host's own address (not the target DB's address). */
  host: string;
  /** The jump host's SSH port, e.g. "22". */
  port: string;
  username: string;
  authMethod: SshAuthMethod;
  /** Only meaningful when `authMethod === "privateKey"`. */
  privateKeyPath?: string;
  // Password / private-key passphrase are deliberately excluded here — same reasoning as
  // `ConnectionProfile.password`: handled via the OS keyring through `sshTunnelSecretBridge.ts`,
  // never persisted alongside the rest of the profile.
};

export const EMPTY_SSH_TUNNEL_CONFIG: SshTunnelConfig = {
  enabled: false,
  host: "",
  port: "22",
  username: "",
  authMethod: "password",
  privateKeyPath: "",
};

/** True when `config` has everything a tunnel actually needs to open. */
export function isSshTunnelConfigComplete(config: SshTunnelConfig): boolean {
  const baseOk =
    config.enabled &&
    config.host.trim().length > 0 &&
    config.port.trim().length > 0 &&
    config.username.trim().length > 0;
  if (!baseOk) return false;
  if (config.authMethod === "password") return true;
  return (config.privateKeyPath ?? "").trim().length > 0;
}

/** Structural validation for data loaded from storage — malformed input never throws. */
export function isValidSshTunnelConfig(value: unknown): value is SshTunnelConfig {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.enabled === "boolean" &&
    typeof record.host === "string" &&
    typeof record.port === "string" &&
    typeof record.username === "string" &&
    (record.authMethod === "password" || record.authMethod === "privateKey") &&
    (record.privateKeyPath === undefined || typeof record.privateKeyPath === "string")
  );
}

/** Normalizes possibly-malformed persisted data, falling back to the empty/disabled config
 *  rather than ever corrupting the rest of the profile it's attached to. */
export function normalizeSshTunnelConfig(value: unknown): SshTunnelConfig {
  return isValidSshTunnelConfig(value) ? value : EMPTY_SSH_TUNNEL_CONFIG;
}

/**
 * Progress phases emitted while opening an SSH tunnel/testing a tunneled connection. Much
 * simpler than the SSM tunnel's `TunnelProgressPhase` — no SSO device flow, so no browser/login
 * phases are needed.
 */
export type SshTunnelProgressPhase = { phase: "startingTunnel" } | { phase: "connectingDatabase" };

export type SshTunnelProgress = (progress: SshTunnelProgressPhase) => void;
