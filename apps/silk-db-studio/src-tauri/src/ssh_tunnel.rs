//! Tauri commands for the built-in SSH jump-host tunnel: per-connection tunnel open/close/status.
//! No SSO/identity-provider step — SSH auth (password or private key) is local and synchronous,
//! so this module is much smaller than `ssm_tunnel.rs`.

use serde::Serialize;
use ssh_tunnel_client::{SshAuth, TunnelManager};
use std::path::PathBuf;
use tauri::State;

pub struct SshTunnelState {
    pub tunnels: TunnelManager,
}

fn require_nonempty(value: &str, field: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{field} is required."));
    }
    Ok(trimmed.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshTunnelOpenResultDto {
    pub local_port: u16,
}

#[tauri::command]
pub async fn ssh_tunnel_open(
    connection_id: String,
    jump_host: String,
    jump_port: u16,
    username: String,
    auth_method: String,
    password: Option<String>,
    private_key_path: Option<String>,
    passphrase: Option<String>,
    remote_host: String,
    remote_port: u16,
    state: State<'_, SshTunnelState>,
) -> Result<SshTunnelOpenResultDto, String> {
    let connection_id = require_nonempty(&connection_id, "connection_id")?;
    let jump_host = require_nonempty(&jump_host, "jump_host")?;
    let username = require_nonempty(&username, "username")?;
    let remote_host = require_nonempty(&remote_host, "remote_host")?;

    let auth = match auth_method.as_str() {
        "password" => {
            let password = password.filter(|value| !value.is_empty()).ok_or("password is required.")?;
            SshAuth::Password(password)
        }
        "privateKey" => {
            let key_path = private_key_path
                .filter(|value| !value.trim().is_empty())
                .ok_or("private_key_path is required.")?;
            SshAuth::PrivateKey { key_path: PathBuf::from(key_path.trim()), passphrase }
        }
        other => return Err(format!("Unsupported auth method: {other}")),
    };

    let local_port = TunnelManager::pick_free_local_port()?;
    state
        .tunnels
        .open(&connection_id, &jump_host, jump_port, &username, auth, &remote_host, remote_port, local_port)
        .await?;
    Ok(SshTunnelOpenResultDto { local_port })
}

#[tauri::command]
pub fn ssh_tunnel_close(connection_id: String, state: State<'_, SshTunnelState>) -> Result<(), String> {
    let connection_id = require_nonempty(&connection_id, "connection_id")?;
    state.tunnels.close(&connection_id);
    Ok(())
}

#[tauri::command]
pub fn ssh_tunnel_status(connection_id: String, state: State<'_, SshTunnelState>) -> Result<bool, String> {
    let connection_id = require_nonempty(&connection_id, "connection_id")?;
    Ok(state.tunnels.is_open(&connection_id))
}
