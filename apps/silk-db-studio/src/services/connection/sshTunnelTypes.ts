/**
 * Optional SSH jump-host (bastion) tunnel layer for a connection profile. When enabled, the
 * connect flow opens a local port-forward through `host`/`port` (the jump host itself) before
 * the JDBC connect, using the profile's own Host/Port (from `ConnectionProfile.url`) as the
 * tunnel's remote target — same convention as `SsmTunnelConfig`.
 *
 * Mutually exclusive with `SsmTunnelConfig` on the same profile — see `connectionService.ts`.
 */
export type SshAuthMethod = "password" | "privateKey";

/**
 * A second SSH hop authenticated *through* the jump host — for targets that only expose their
 * DB port on their own loopback (a common hardening pattern: "only reachable by logging into
 * this box directly"), mirroring a `ProxyJump`-style `~/.ssh/config` entry where the jump host
 * is a pure relay and this host is where the real SSH login (and `LocalForward`) happens. When
 * enabled, `SshTunnelConfig`'s connection profile Host/Port resolve from *this* hop's point of
 * view instead of the jump host's — typically "127.0.0.1" for the loopback case above.
 */
export type SecondHopConfig = {
  enabled: boolean;
  host: string;
  port: string;
  username: string;
  authMethod: SshAuthMethod;
  privateKeyPath?: string;
  // Password / passphrase excluded here too — see SshTunnelConfig's own note below.
};

export const EMPTY_SECOND_HOP_CONFIG: SecondHopConfig = {
  enabled: false,
  host: "",
  port: "22",
  username: "",
  authMethod: "password",
  privateKeyPath: "",
};

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
  secondHop: SecondHopConfig;
};

export const EMPTY_SSH_TUNNEL_CONFIG: SshTunnelConfig = {
  enabled: false,
  host: "",
  port: "22",
  username: "",
  authMethod: "password",
  privateKeyPath: "",
  secondHop: EMPTY_SECOND_HOP_CONFIG,
};

function isSecondHopConfigComplete(config: SecondHopConfig): boolean {
  const baseOk =
    config.enabled &&
    config.host.trim().length > 0 &&
    config.port.trim().length > 0 &&
    config.username.trim().length > 0;
  if (!baseOk) return false;
  if (config.authMethod === "password") return true;
  return (config.privateKeyPath ?? "").trim().length > 0;
}

/** True when `config` has everything a tunnel actually needs to open. */
export function isSshTunnelConfigComplete(config: SshTunnelConfig): boolean {
  const baseOk =
    config.enabled &&
    config.host.trim().length > 0 &&
    config.port.trim().length > 0 &&
    config.username.trim().length > 0;
  if (!baseOk) return false;
  if (config.authMethod === "privateKey" && (config.privateKeyPath ?? "").trim().length === 0) {
    return false;
  }
  return !config.secondHop.enabled || isSecondHopConfigComplete(config.secondHop);
}

function isValidSecondHopConfig(value: unknown): value is SecondHopConfig {
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
    (record.privateKeyPath === undefined || typeof record.privateKeyPath === "string") &&
    // Profiles saved before the second-hop feature existed have no `secondHop` field —
    // treat that as "disabled" rather than rejecting the whole (otherwise valid) config.
    (record.secondHop === undefined || isValidSecondHopConfig(record.secondHop))
  );
}

/** Normalizes possibly-malformed persisted data, falling back to the empty/disabled config
 *  rather than ever corrupting the rest of the profile it's attached to. */
export function normalizeSshTunnelConfig(value: unknown): SshTunnelConfig {
  if (!isValidSshTunnelConfig(value)) return EMPTY_SSH_TUNNEL_CONFIG;
  // Older profiles predate `secondHop` — `isValidSshTunnelConfig` accepts them as structurally
  // valid (disabled second hop), but the type itself requires the field, so fill it in here.
  return { ...value, secondHop: value.secondHop ?? EMPTY_SECOND_HOP_CONFIG };
}

/**
 * Progress phases emitted while opening an SSH tunnel/testing a tunneled connection. Much
 * simpler than the SSM tunnel's `TunnelProgressPhase` — no SSO device flow, so no browser/login
 * phases are needed.
 */
export type SshTunnelProgressPhase = { phase: "startingTunnel" } | { phase: "connectingDatabase" };

export type SshTunnelProgress = (progress: SshTunnelProgressPhase) => void;
