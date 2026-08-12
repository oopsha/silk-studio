/**
 * Optional AWS SSM Session Manager tunnel layer for a connection profile. When enabled, the
 * connect flow opens a local port-forward through `targetInstanceId` (any SSM-managed
 * instance in the same VPC — not a traditional bastion) before the JDBC connect, using the
 * profile's own Host/Port (from `ConnectionProfile.url`) as the tunnel's remote target.
 */
export type SsmTunnelConfig = {
  enabled: boolean;
  region: string;
  /** e.g. https://my-org.awsapps.com/start */
  ssoStartUrl: string;
  /** e.g. i-0123456789abcdef0 */
  targetInstanceId: string;
};

export const EMPTY_SSM_TUNNEL_CONFIG: SsmTunnelConfig = {
  enabled: false,
  region: "",
  ssoStartUrl: "",
  targetInstanceId: "",
};

/** True when `config` has everything a tunnel actually needs to open. */
export function isSsmTunnelConfigComplete(config: SsmTunnelConfig): boolean {
  return (
    config.enabled &&
    config.region.trim().length > 0 &&
    config.ssoStartUrl.trim().length > 0 &&
    config.targetInstanceId.trim().length > 0
  );
}

/** Structural validation for data loaded from storage — malformed input never throws. */
export function isValidSsmTunnelConfig(value: unknown): value is SsmTunnelConfig {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.enabled === "boolean" &&
    typeof record.region === "string" &&
    typeof record.ssoStartUrl === "string" &&
    typeof record.targetInstanceId === "string"
  );
}

/** Normalizes possibly-malformed persisted data, falling back to the empty/disabled config
 *  rather than ever corrupting the rest of the profile it's attached to. */
export function normalizeSsmTunnelConfig(value: unknown): SsmTunnelConfig {
  return isValidSsmTunnelConfig(value) ? value : EMPTY_SSM_TUNNEL_CONFIG;
}

/**
 * Progress phases emitted while opening a tunnel/testing a tunneled connection. Kept as
 * structured phase keys (not literal strings) so UI callers can translate them via i18n
 * instead of baking English text into the service layer.
 */
export type TunnelProgressPhase =
  | { phase: "openingBrowser" }
  | { phase: "waitingForSignIn"; userCode: string }
  | { phase: "loadingInstances" }
  | { phase: "startingTunnel" }
  | { phase: "connectingDatabase" };

export type TunnelProgress = (progress: TunnelProgressPhase) => void;

/**
 * Key used for the SSO token cache and the tunnel's subprocess table. A saved profile's own id
 * is used when available; an unsaved profile being edited (no id yet) falls back to a key
 * derived from region + SSO Start URL only — deliberately NOT `targetInstanceId`, since that's
 * exactly what "Load Instances" doesn't know yet when it triggers a login, and it can change
 * between clicks. Keying on it would treat every such change as a different AWS identity and
 * force a fresh browser login even though the AWS SSO session is unchanged.
 */
export function tunnelSessionKey(
  profileId: string | undefined,
  config: SsmTunnelConfig,
): string {
  if (profileId) return profileId;
  return `pending:${config.region}:${config.ssoStartUrl}`;
}
