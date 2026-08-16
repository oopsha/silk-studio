//! Tauri commands for the built-in SSH jump-host tunnel: per-connection tunnel open/close/status.
//! No SSO/identity-provider step — SSH auth (password or private key) is local and synchronous,
//! so this module is much smaller than `ssm_tunnel.rs`.

use serde::Serialize;
use ssh_tunnel_client::{SecondHop, SshAuth, TunnelManager};
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

fn parse_auth(
    auth_method: &str,
    password: Option<String>,
    private_key_path: Option<String>,
    passphrase: Option<String>,
) -> Result<SshAuth, String> {
    match auth_method {
        "password" => {
            let password = password.filter(|value| !value.is_empty()).ok_or("password is required.")?;
            Ok(SshAuth::Password(password))
        }
        "privateKey" => {
            let key_path = private_key_path
                .filter(|value| !value.trim().is_empty())
                .ok_or("private_key_path is required.")?;
            Ok(SshAuth::PrivateKey { key_path: PathBuf::from(key_path.trim()), passphrase })
        }
        other => Err(format!("Unsupported auth method: {other}")),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshTunnelOpenResultDto {
    pub local_port: u16,
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn ssh_tunnel_open(
    connection_id: String,
    jump_host: String,
    jump_port: u16,
    username: String,
    auth_method: String,
    password: Option<String>,
    private_key_path: Option<String>,
    passphrase: Option<String>,
    // Second hop (see `SecondHop`'s doc) — omitted/empty `target_host` means "no second hop,
    // forward directly from the jump host" (the original single-hop behavior).
    target_host: Option<String>,
    target_port: Option<u16>,
    target_username: Option<String>,
    target_auth_method: Option<String>,
    target_password: Option<String>,
    target_private_key_path: Option<String>,
    target_passphrase: Option<String>,
    remote_host: String,
    remote_port: u16,
    state: State<'_, SshTunnelState>,
) -> Result<SshTunnelOpenResultDto, String> {
    let connection_id = require_nonempty(&connection_id, "connection_id")?;
    let jump_host = require_nonempty(&jump_host, "jump_host")?;
    let username = require_nonempty(&username, "username")?;
    let remote_host = require_nonempty(&remote_host, "remote_host")?;
    let auth = parse_auth(&auth_method, password, private_key_path, passphrase)?;

    let second_hop = match target_host.filter(|value| !value.trim().is_empty()) {
        Some(host) => {
            let target_username = target_username
                .filter(|value| !value.trim().is_empty())
                .ok_or("target_username is required when a target host is set.")?;
            let target_auth_method = target_auth_method
                .ok_or("target_auth_method is required when a target host is set.")?;
            let auth = parse_auth(
                &target_auth_method,
                target_password,
                target_private_key_path,
                target_passphrase,
            )?;
            Some(SecondHop {
                host: host.trim().to_string(),
                port: target_port.unwrap_or(22),
                username: target_username.trim().to_string(),
                auth,
            })
        }
        None => None,
    };

    let local_port = TunnelManager::pick_free_local_port()?;
    state
        .tunnels
        .open(
            &connection_id,
            &jump_host,
            jump_port,
            &username,
            auth,
            second_hop,
            &remote_host,
            remote_port,
            local_port,
        )
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
