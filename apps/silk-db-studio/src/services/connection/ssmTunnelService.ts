import { openExternalUrl } from "@silk-studio/workbench/platform/openExternalUrl.ts";
import {
  bridgeSsmListInstances,
  bridgeSsmSsoIsSignedIn,
  bridgeSsmSsoPollLogin,
  bridgeSsmSsoStartLogin,
  bridgeSsmTunnelClose,
  bridgeSsmTunnelOpen,
  type SsmInstanceSummary,
} from "./ssmTunnelBridge";
import { buildJdbcUrl, parseJdbcUrl } from "./connectionUrlBuilder";
import type { ConnectionDriverId } from "./connectionTypes";
import type { SsmTunnelConfig, TunnelProgress } from "./ssmTunnelTypes";

export type { TunnelProgress } from "./ssmTunnelTypes";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Opens the browser for AWS SSO device-flow login and polls until the user completes it (or
 * it's denied/expires). No-ops (beyond a signed-in check) if a still-valid token is already
 * cached for this profile — see `ssm_sso_is_signed_in` in the Rust layer.
 */
async function ensureSignedIn(
  profileId: string,
  region: string,
  ssoStartUrl: string,
  onProgress?: TunnelProgress,
): Promise<void> {
  if (await bridgeSsmSsoIsSignedIn(profileId)) {
    return;
  }

  onProgress?.({ phase: "openingBrowser" });
  const device = await bridgeSsmSsoStartLogin(region, ssoStartUrl);
  await openExternalUrl(device.verificationUriComplete);

  onProgress?.({ phase: "waitingForSignIn", userCode: device.userCode });
  const deadline = Date.now() + device.expiresInSecs * 1000;
  let intervalMs = Math.max(1, device.intervalSecs) * 1000;

  while (Date.now() < deadline) {
    await sleep(intervalMs);
    const result = await bridgeSsmSsoPollLogin(
      profileId,
      region,
      device.clientId,
      device.clientSecret,
      device.deviceCode,
    );
    if (result.status === "complete") return;
    if (result.status === "expired") {
      throw new Error("AWS SSO sign-in expired before it was completed.");
    }
    if (result.status === "denied") {
      throw new Error("AWS SSO sign-in was denied.");
    }
    if (result.status === "slowDown") {
      intervalMs += 5000;
    }
  }
  throw new Error("AWS SSO sign-in timed out.");
}

export async function listSsmInstances(
  profileId: string,
  region: string,
  ssoStartUrl: string,
  onProgress?: TunnelProgress,
): Promise<SsmInstanceSummary[]> {
  await ensureSignedIn(profileId, region, ssoStartUrl, onProgress);
  onProgress?.({ phase: "loadingInstances" });
  return bridgeSsmListInstances(profileId, region);
}

/**
 * Opens the SSM tunnel for `connectionId`, targeting the host/port already encoded in the
 * profile's own `url` (never a separately-stored remote host/port — see `SsmTunnelConfig`'s
 * doc comment). Returns a rewritten JDBC URL pointing at the local tunnel port — `url` itself
 * is never mutated; the caller must use this returned string only for the connect call.
 */
export async function openSsmTunnelForConnect(
  connectionId: string,
  profileId: string,
  driverId: ConnectionDriverId,
  url: string,
  tunnel: SsmTunnelConfig,
  onProgress?: TunnelProgress,
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

  await ensureSignedIn(profileId, tunnel.region, tunnel.ssoStartUrl, onProgress);

  onProgress?.({ phase: "startingTunnel" });
  const result = await bridgeSsmTunnelOpen(
    connectionId,
    profileId,
    tunnel.region,
    tunnel.targetInstanceId,
    parsed.host,
    remotePort,
  );
  return buildJdbcUrl(driverId, {
    ...parsed,
    host: "127.0.0.1",
    port: String(result.localPort),
  });
}

export async function closeSsmTunnel(connectionId: string): Promise<void> {
  await bridgeSsmTunnelClose(connectionId);
}
