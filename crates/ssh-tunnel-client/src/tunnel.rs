//! Per-connection SSH jump-host tunnel lifecycle. Mirrors `ssm-tunnel-client`'s `TunnelManager`
//! shape (keyed by `connectionId`, `open`/`close`/`is_open`/`local_port`), but built on `russh`
//! (a pure-Rust SSH implementation) instead of shelling out to an external plugin binary — there
//! is no child process, so none of the path/console-window issues the bundled
//! `session-manager-plugin` executable has apply here.
//!
//! Readiness is inherent to `russh`'s async API (a successful `connect`/`authenticate` call
//! *is* the readiness signal), so unlike the SSM tunnel there is no stdout-marker sniffing or
//! poll loop.

use russh::client::{Config, Handle, Handler};
use russh::keys::{load_secret_key, PrivateKeyWithHashAlg};
use std::collections::HashMap;
use std::net::TcpListener as StdTcpListener;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tokio::io::copy_bidirectional;
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tokio::task::JoinHandle;

/// How the client authenticates to the jump host. SSH-agent auth is deliberately out of scope
/// for v1 — see the SSH tunnel design plan.
pub enum SshAuth {
    Password(String),
    PrivateKey { key_path: PathBuf, passphrase: Option<String> },
}

struct TunnelHandle {
    shutdown: oneshot::Sender<()>,
    local_port: u16,
    task: JoinHandle<()>,
}

pub struct TunnelManager {
    active: Mutex<HashMap<String, TunnelHandle>>,
}

impl Default for TunnelManager {
    fn default() -> Self {
        Self::new()
    }
}

impl TunnelManager {
    pub fn new() -> Self {
        Self { active: Mutex::new(HashMap::new()) }
    }

    /// Binds a port-0 listener to obtain an OS-assigned free local port, then immediately
    /// releases it. Same small TOCTOU tradeoff as the SSM tunnel's identical helper.
    pub fn pick_free_local_port() -> Result<u16, String> {
        let listener = StdTcpListener::bind("127.0.0.1:0")
            .map_err(|e| format!("Failed to find a free local port: {e}"))?;
        listener
            .local_addr()
            .map(|addr| addr.port())
            .map_err(|e| format!("Failed to read bound port: {e}"))
    }

    /// Opens an SSH connection to `jump_host:jump_port`, authenticates, binds a local listener
    /// on `local_port`, and spawns a background task that forwards every accepted local
    /// connection to `remote_host:remote_port` through a `direct-tcpip` channel — replacing any
    /// existing tunnel for `connection_id` first (mirrors the SSM tunnel's replace semantics).
    pub async fn open(
        &self,
        connection_id: &str,
        jump_host: &str,
        jump_port: u16,
        username: &str,
        auth: SshAuth,
        remote_host: &str,
        remote_port: u16,
        local_port: u16,
    ) -> Result<(), String> {
        self.close(connection_id);

        let config = Arc::new(Config::default());
        let mut handle: Handle<AcceptAllHostKeys> =
            russh::client::connect(config, (jump_host, jump_port), AcceptAllHostKeys)
                .await
                .map_err(|error| format!("Failed to connect to {jump_host}:{jump_port}: {error}"))?;

        let auth_result = match auth {
            SshAuth::Password(password) => handle
                .authenticate_password(username, password)
                .await
                .map_err(|error| format!("SSH authentication failed: {error}"))?,
            SshAuth::PrivateKey { key_path, passphrase } => {
                let key = load_secret_key(&key_path, passphrase.as_deref()).map_err(|error| {
                    format!("Failed to load private key {}: {error}", key_path.display())
                })?;
                let key = PrivateKeyWithHashAlg::new(Arc::new(key), None);
                handle
                    .authenticate_publickey(username, key)
                    .await
                    .map_err(|error| format!("SSH authentication failed: {error}"))?
            }
        };
        if !auth_result.success() {
            return Err("SSH authentication was rejected by the jump host.".to_string());
        }

        let listener = TcpListener::bind(("127.0.0.1", local_port))
            .await
            .map_err(|error| format!("Failed to bind local port {local_port}: {error}"))?;

        let handle = Arc::new(handle);
        let remote_host = remote_host.to_string();
        let (shutdown_tx, mut shutdown_rx) = oneshot::channel();

        let task = tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = &mut shutdown_rx => break,
                    accepted = listener.accept() => {
                        let Ok((mut local_stream, _)) = accepted else { continue };
                        let handle = Arc::clone(&handle);
                        let remote_host = remote_host.clone();
                        tokio::spawn(async move {
                            let channel = match handle
                                .channel_open_direct_tcpip(
                                    remote_host.as_str(),
                                    remote_port as u32,
                                    "127.0.0.1",
                                    local_port as u32,
                                )
                                .await
                            {
                                Ok(channel) => channel,
                                Err(_) => return,
                            };
                            let mut remote_stream = channel.into_stream();
                            let _ = copy_bidirectional(&mut local_stream, &mut remote_stream).await;
                        });
                    }
                }
            }
        });

        let mut active = self
            .active
            .lock()
            .map_err(|_| "Failed to lock SSH tunnel table".to_string())?;
        active.insert(connection_id.to_string(), TunnelHandle { shutdown: shutdown_tx, local_port, task });
        Ok(())
    }

    /// Closes the tunnel for `connection_id`, if any. Safe to call unconditionally (e.g. from a
    /// disconnect path) — a no-op when nothing is open.
    pub fn close(&self, connection_id: &str) {
        let Ok(mut active) = self.active.lock() else { return };
        if let Some(handle) = active.remove(connection_id) {
            let _ = handle.shutdown.send(());
            handle.task.abort();
        }
    }

    pub fn is_open(&self, connection_id: &str) -> bool {
        self.active.lock().map(|active| active.contains_key(connection_id)).unwrap_or(false)
    }

    pub fn local_port(&self, connection_id: &str) -> Option<u16> {
        self.active.lock().ok()?.get(connection_id).map(|handle| handle.local_port)
    }
}

impl Drop for TunnelManager {
    fn drop(&mut self) {
        if let Ok(mut active) = self.active.lock() {
            for (_, handle) in active.drain() {
                let _ = handle.shutdown.send(());
                handle.task.abort();
            }
        }
    }
}

/// Accepts any host key. SSH host-key pinning/known_hosts verification is out of scope for v1
/// (same risk tradeoff DBeaver's own "bypass host key verification" option makes) — flagged as
/// a follow-up rather than silently assumed safe.
struct AcceptAllHostKeys;

impl Handler for AcceptAllHostKeys {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &russh::keys::ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pick_free_local_port_returns_a_nonzero_port() {
        let port = TunnelManager::pick_free_local_port().expect("should find a free port");
        assert!(port > 0);
    }

    #[test]
    fn is_open_false_for_unknown_connection() {
        let manager = TunnelManager::new();
        assert!(!manager.is_open("nonexistent"));
        assert!(manager.local_port("nonexistent").is_none());
    }

    #[test]
    fn close_is_a_no_op_when_nothing_is_open() {
        let manager = TunnelManager::new();
        manager.close("nonexistent");
        assert!(!manager.is_open("nonexistent"));
    }

    #[tokio::test]
    async fn open_fails_cleanly_when_jump_host_is_unreachable() {
        let manager = TunnelManager::new();
        let local_port = TunnelManager::pick_free_local_port().expect("free port");
        let result = manager
            .open(
                "conn-1",
                "127.0.0.1",
                1, // nothing listens on port 1
                "tester",
                SshAuth::Password("wrong".into()),
                "10.0.0.1",
                5432,
                local_port,
            )
            .await;
        assert!(result.is_err());
        assert!(!manager.is_open("conn-1"));
    }
}
