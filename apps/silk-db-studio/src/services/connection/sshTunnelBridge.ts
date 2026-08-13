import { invoke, isTauri } from "@tauri-apps/api/core";
import type { SshAuthMethod } from "./sshTunnelTypes";

export type SshTunnelOpenResult = {
  localPort: number;
};

export async function bridgeSshTunnelOpen(
  connectionId: string,
  jumpHost: string,
  jumpPort: number,
  username: string,
  authMethod: SshAuthMethod,
  password: string | undefined,
  privateKeyPath: string | undefined,
  passphrase: string | undefined,
  remoteHost: string,
  remotePort: number,
): Promise<SshTunnelOpenResult> {
  if (!isTauri()) {
    throw new Error("SSH tunneling is available in the desktop app only.");
  }
  return invoke<SshTunnelOpenResult>("ssh_tunnel_open", {
    connectionId: connectionId.trim(),
    jumpHost: jumpHost.trim(),
    jumpPort,
    username: username.trim(),
    authMethod,
    password,
    privateKeyPath,
    passphrase,
    remoteHost: remoteHost.trim(),
    remotePort,
  });
}

export async function bridgeSshTunnelClose(connectionId: string): Promise<void> {
  if (!isTauri()) return;
  const id = connectionId.trim();
  if (!id) return;
  await invoke("ssh_tunnel_close", { connectionId: id });
}

export async function bridgeSshTunnelStatus(connectionId: string): Promise<boolean> {
  if (!isTauri()) return false;
  const id = connectionId.trim();
  if (!id) return false;
  return invoke<boolean>("ssh_tunnel_status", { connectionId: id });
}
