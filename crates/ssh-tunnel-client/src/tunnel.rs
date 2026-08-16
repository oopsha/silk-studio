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
use russh::keys::{load_secret_key, HashAlg, PrivateKeyWithHashAlg};
use std::collections::HashMap;
use std::net::TcpListener as StdTcpListener;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tokio::io::copy_bidirectional;
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tokio::task::JoinHandle;

/// How the client authenticates to a hop (jump host or second hop). SSH-agent auth is
/// deliberately out of scope for v1 — see the SSH tunnel design plan.
pub enum SshAuth {
    Password(String),
    PrivateKey { key_path: PathBuf, passphrase: Option<String> },
}

/// A second SSH hop authenticated *through* the jump host, for targets that only expose the
/// destination port on their own loopback (common DB hardening: "only reachable by logging into
/// this box directly"). Mirrors a `ProxyJump`-style `~/.ssh/config` entry where `HostName` is the
/// real target and the jump host is a pure relay — e.g.
/// ```text
/// Host target
///   HostName 10.0.7.141
///   ProxyJump bastion
///   LocalForward 1433 127.0.0.1:1433
/// ```
/// When present, `remote_host`/`remote_port` in [`TunnelManager::open`] are resolved from this
/// hop's point of view instead of the jump host's (typically `127.0.0.1` for the loopback case
/// above).
pub struct SecondHop {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: SshAuth,
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

    /// Opens an SSH connection to `jump_host:jump_port`, authenticates, optionally chains a
    /// second SSH session through it (see [`SecondHop`]), binds a local listener on
    /// `local_port`, and spawns a background task that forwards every accepted local connection
    /// to `remote_host:remote_port` through a `direct-tcpip` channel opened on whichever hop is
    /// last in the chain — replacing any existing tunnel for `connection_id` first (mirrors the
    /// SSM tunnel's replace semantics).
    pub async fn open(
        &self,
        connection_id: &str,
        jump_host: &str,
        jump_port: u16,
        username: &str,
        auth: SshAuth,
        second_hop: Option<SecondHop>,
        remote_host: &str,
        remote_port: u16,
        local_port: u16,
    ) -> Result<(), String> {
        self.close(connection_id);

        let config = Arc::new(Config::default());
        let mut hop1: Handle<AcceptAllHostKeys> =
            russh::client::connect(Arc::clone(&config), (jump_host, jump_port), AcceptAllHostKeys)
                .await
                .map_err(|error| format!("Failed to connect to {jump_host}:{jump_port}: {error}"))?;
        authenticate(&mut hop1, username, auth, "the jump host").await?;
        let hop1 = Arc::new(hop1);

        // When a second hop is configured, don't forward directly from the jump host — instead
        // open a `direct-tcpip` channel *to the second hop's own SSH port* through hop1, then
        // layer a brand new SSH client session on top of that channel's byte stream
        // (`connect_stream`, the same primitive `connect` itself uses internally over a raw
        // TcpStream). This is exactly what OpenSSH's `ProxyJump` does at the protocol level —
        // hop1 never sees anything past an opaque encrypted stream, and `remote_host`/
        // `remote_port` below resolve from the second hop's point of view (typically
        // `127.0.0.1` for a service that's hardened to only accept local connections).
        let forwarding_handle: Arc<Handle<AcceptAllHostKeys>> = match second_hop {
            Some(second_hop) => {
                let channel = hop1
                    .channel_open_direct_tcpip(
                        second_hop.host.as_str(),
                        second_hop.port as u32,
                        "127.0.0.1",
                        0,
                    )
                    .await
                    .map_err(|error| {
                        format!(
                            "Failed to reach {}:{} through the jump host: {error}",
                            second_hop.host, second_hop.port
                        )
                    })?;
                let mut hop2: Handle<AcceptAllHostKeys> =
                    russh::client::connect_stream(config, channel.into_stream(), AcceptAllHostKeys)
                        .await
                        .map_err(|error| {
                            format!("Failed to start an SSH session with {}: {error}", second_hop.host)
                        })?;
                authenticate(&mut hop2, &second_hop.username, second_hop.auth, "the target host")
                    .await?;
                Arc::new(hop2)
            }
            None => Arc::clone(&hop1),
        };

        let listener = TcpListener::bind(("127.0.0.1", local_port))
            .await
            .map_err(|error| format!("Failed to bind local port {local_port}: {error}"))?;

        let remote_host = remote_host.to_string();
        let (shutdown_tx, mut shutdown_rx) = oneshot::channel();

        let task = tokio::spawn(async move {
            // Keeps hop1's SSH session alive for as long as the tunnel is open even when it's
            // not used directly for forwarding — when a second hop is chained, hop2's entire
            // connection is tunneled through hop1's channel, so dropping hop1 early would sever
            // it. Never read past this binding; it exists purely to extend hop1's lifetime.
            let _hop1_keepalive = hop1;
            loop {
                tokio::select! {
                    _ = &mut shutdown_rx => break,
                    accepted = listener.accept() => {
                        let Ok((mut local_stream, _)) = accepted else { continue };
                        let handle = Arc::clone(&forwarding_handle);
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
                                Err(error) => {
                                    // A failed direct-tcpip open previously just dropped the
                                    // local socket silently — indistinguishable from a normal
                                    // TCP reset to the JDBC client, and impossible to diagnose.
                                    // Most common cause: remote_host:remote_port isn't reachable
                                    // *from the jump host's own network view* (e.g. a service
                                    // bound to loopback only on some other box, or a firewall
                                    // rule) — surface it so it shows up in the dev/app log.
                                    eprintln!(
                                        "[ssh-tunnel] direct-tcpip channel to {remote_host}:{remote_port} failed: {error}"
                                    );
                                    return;
                                }
                            };
                            let mut remote_stream = channel.into_stream();
                            if let Err(error) =
                                copy_bidirectional(&mut local_stream, &mut remote_stream).await
                            {
                                eprintln!(
                                    "[ssh-tunnel] tunnel to {remote_host}:{remote_port} closed: {error}"
                                );
                            }
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

/// Authenticates `handle` as `username` using `auth`, applying the same RSA hash-algorithm
/// negotiation regardless of which hop this is (see the inline comment on the single-hop
/// version of this logic, kept as history in git blame) — shared so hop1 and hop2 can't drift.
async fn authenticate<H: Handler>(
    handle: &mut Handle<H>,
    username: &str,
    auth: SshAuth,
    hop_label: &str,
) -> Result<(), String> {
    let auth_result = match auth {
        SshAuth::Password(password) => handle
            .authenticate_password(username, password)
            .await
            .map_err(|error| format!("SSH authentication to {hop_label} failed: {error}"))?,
        SshAuth::PrivateKey { key_path, passphrase } => {
            let key = load_secret_key(&key_path, passphrase.as_deref()).map_err(|error| {
                format!("Failed to load private key {}: {error}", key_path.display())
            })?;
            // For RSA keys, `PrivateKeyWithHashAlg::new(_, None)` signs with the legacy
            // `ssh-rsa` (SHA-1) algorithm, which most modern OpenSSH servers (8.8+, default
            // since ~2021) reject outright — surfacing as a confusing "authentication was
            // rejected" even though the key itself is correct. Ask the server what it actually
            // supports via the `server-sig-algs` extension and fall back to the now-universal
            // `rsa-sha2-256` when the server doesn't advertise it (non-RSA keys ignore this
            // value entirely, per `PrivateKeyWithHashAlg::new`'s own doc).
            let hash_alg = match handle.best_supported_rsa_hash().await {
                Ok(Some(alg)) => alg,
                _ => Some(HashAlg::Sha256),
            };
            let key = PrivateKeyWithHashAlg::new(Arc::new(key), hash_alg);
            handle
                .authenticate_publickey(username, key)
                .await
                .map_err(|error| format!("SSH authentication to {hop_label} failed: {error}"))?
        }
    };
    if !auth_result.success() {
        return Err(format!("SSH authentication was rejected by {hop_label}."));
    }
    Ok(())
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
                None,
                "10.0.0.1",
                5432,
                local_port,
            )
            .await;
        assert!(result.is_err());
        assert!(!manager.is_open("conn-1"));
    }
}
