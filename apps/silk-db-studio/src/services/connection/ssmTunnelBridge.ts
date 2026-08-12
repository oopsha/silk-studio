import { invoke, isTauri } from "@tauri-apps/api/core";

export type DeviceAuthorization = {
  clientId: string;
  clientSecret: string;
  deviceCode: string;
  userCode: string;
  verificationUriComplete: string;
  intervalSecs: number;
  expiresInSecs: number;
};

export type SsoLoginStatus =
  | { status: "pending" }
  | { status: "slowDown" }
  | { status: "complete" }
  | { status: "expired" }
  | { status: "denied" };

export type SsmInstanceSummary = {
  instanceId: string;
  name: string | null;
  pingStatus: string;
  platformType: string;
};

export async function bridgeSsmSsoStartLogin(
  region: string,
  startUrl: string,
): Promise<DeviceAuthorization> {
  if (!isTauri()) {
    throw new Error("AWS SSO login is available in the desktop app only.");
  }
  return invoke<DeviceAuthorization>("ssm_sso_start_login", {
    region: region.trim(),
    startUrl: startUrl.trim(),
  });
}

export async function bridgeSsmSsoPollLogin(
  profileId: string,
  region: string,
  clientId: string,
  clientSecret: string,
  deviceCode: string,
): Promise<SsoLoginStatus> {
  if (!isTauri()) {
    throw new Error("AWS SSO login is available in the desktop app only.");
  }
  return invoke<SsoLoginStatus>("ssm_sso_poll_login", {
    profileId: profileId.trim(),
    region: region.trim(),
    clientId,
    clientSecret,
    deviceCode,
  });
}

export async function bridgeSsmSsoIsSignedIn(profileId: string): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>("ssm_sso_is_signed_in", { profileId: profileId.trim() });
}

export async function bridgeSsmListInstances(
  profileId: string,
  region: string,
): Promise<SsmInstanceSummary[]> {
  if (!isTauri()) {
    throw new Error("AWS SSM instance listing is available in the desktop app only.");
  }
  return invoke<SsmInstanceSummary[]>("ssm_list_instances", {
    profileId: profileId.trim(),
    region: region.trim(),
  });
}

export type SsmTunnelOpenResult = {
  localPort: number;
};

export async function bridgeSsmTunnelOpen(
  connectionId: string,
  profileId: string,
  region: string,
  targetInstanceId: string,
  remoteHost: string,
  remotePort: number,
): Promise<SsmTunnelOpenResult> {
  if (!isTauri()) {
    throw new Error("AWS SSM tunneling is available in the desktop app only.");
  }
  return invoke<SsmTunnelOpenResult>("ssm_tunnel_open", {
    connectionId: connectionId.trim(),
    profileId: profileId.trim(),
    region: region.trim(),
    targetInstanceId: targetInstanceId.trim(),
    remoteHost: remoteHost.trim(),
    remotePort,
  });
}

export async function bridgeSsmTunnelClose(connectionId: string): Promise<void> {
  if (!isTauri()) return;
  const id = connectionId.trim();
  if (!id) return;
  await invoke("ssm_tunnel_close", { connectionId: id });
}

export async function bridgeSsmTunnelStatus(connectionId: string): Promise<boolean> {
  if (!isTauri()) return false;
  const id = connectionId.trim();
  if (!id) return false;
  return invoke<boolean>("ssm_tunnel_status", { connectionId: id });
}
