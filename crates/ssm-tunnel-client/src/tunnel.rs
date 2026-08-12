//! Per-connection `session-manager-plugin` subprocess lifecycle. Unlike the shared
//! jdbc-agent JVM singleton, each SSM tunnel targets a possibly-different instance/region,
//! so tunnels are tracked per `connectionId` in a map rather than as one shared process.

use crate::ssm_api::StartSessionResult;
use serde_json::json;
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

/// How long to wait for the plugin to actually start accepting local connections before
/// giving up. The plugin has to open a WebSocket to AWS and complete the SSM handshake first,
/// so this is not instantaneous — but a JDBC connect attempt that races ahead of it fails with
/// a confusing "no listener" error instead of a clear tunnel-startup error.
const READY_TIMEOUT: Duration = Duration::from_secs(15);
const POLL_INTERVAL: Duration = Duration::from_millis(250);

struct TunnelHandle {
    child: Child,
    local_port: u16,
}

pub struct TunnelManager {
    plugin_bin: PathBuf,
    active: Mutex<HashMap<String, TunnelHandle>>,
}

impl TunnelManager {
    pub fn new(plugin_bin: PathBuf) -> Self {
        Self { plugin_bin, active: Mutex::new(HashMap::new()) }
    }

    /// Binds a port-0 listener to obtain an OS-assigned free local port, then immediately
    /// releases it. Small TOCTOU race between release and the plugin binding it — the same
    /// tradeoff most local-tunnel tools accept rather than requiring a fixed reserved port.
    pub fn pick_free_local_port() -> Result<u16, String> {
        let listener = TcpListener::bind("127.0.0.1:0")
            .map_err(|e| format!("Failed to find a free local port: {e}"))?;
        listener
            .local_addr()
            .map(|addr| addr.port())
            .map_err(|e| format!("Failed to read bound port: {e}"))
    }

    /// Spawns `session-manager-plugin` for `connection_id`, replacing any tunnel already open
    /// for that id, and blocks until the local port actually accepts a connection (or the
    /// process dies / times out trying). `session` must carry the `request_params_json` from
    /// the matching `StartSession` call — the plugin requires that exact JSON as a launch arg.
    pub fn open(
        &self,
        connection_id: &str,
        session: &StartSessionResult,
        region: &str,
        endpoint: &str,
        local_port: u16,
    ) -> Result<(), String> {
        self.close(connection_id);

        let session_json = json!({
            "SessionId": session.session_id,
            "TokenValue": session.token_value,
            "StreamUrl": session.stream_url,
        })
        .to_string();

        // AWS's documented session-manager-plugin CLI contract (this is what `aws ssm
        // start-session` itself invokes under the hood): <plugin> <start-session-response-json>
        // <region> "StartSession" <profile:empty, credentials come from our own signed call>
        // <start-session-request-json> <ssm-endpoint>.
        let mut child = Command::new(&self.plugin_bin)
            .arg(session_json)
            .arg(region)
            .arg("StartSession")
            .arg("")
            .arg(&session.request_params_json)
            .arg(endpoint)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn session-manager-plugin: {e}"))?;

        // Drain stdout/stderr on background threads (the plugin can block writing to a full
        // pipe otherwise) and keep stderr's tail around for diagnostics if readiness fails.
        let stderr_tail = Arc::new(Mutex::new(String::new()));
        if let Some(stdout) = child.stdout.take() {
            thread::spawn(move || {
                for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                    let _ = line;
                }
            });
        }
        if let Some(stderr) = child.stderr.take() {
            let tail = Arc::clone(&stderr_tail);
            thread::spawn(move || {
                for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                    if let Ok(mut guard) = tail.lock() {
                        guard.push_str(&line);
                        guard.push('\n');
                    }
                }
            });
        }

        if let Err(error) = wait_until_ready(&mut child, local_port, &stderr_tail) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }

        self.active
            .lock()
            .unwrap()
            .insert(connection_id.to_string(), TunnelHandle { child, local_port });
        Ok(())
    }

    /// No-op if nothing is open for `connection_id` — safe to call unconditionally from a
    /// disconnect path.
    pub fn close(&self, connection_id: &str) {
        if let Some(mut handle) = self.active.lock().unwrap().remove(connection_id) {
            let _ = handle.child.kill();
            let _ = handle.child.wait();
        }
    }

    pub fn is_open(&self, connection_id: &str) -> bool {
        self.active.lock().unwrap().contains_key(connection_id)
    }

    pub fn local_port(&self, connection_id: &str) -> Option<u16> {
        self.active.lock().unwrap().get(connection_id).map(|h| h.local_port)
    }
}

/// Polls `127.0.0.1:{local_port}` until it accepts a connection, the child process exits, or
/// `READY_TIMEOUT` elapses. Not a general health check — just "has the plugin bound the port
/// yet" — so a successful connect here is closed immediately without sending anything.
fn wait_until_ready(
    child: &mut Child,
    local_port: u16,
    stderr_tail: &Arc<Mutex<String>>,
) -> Result<(), String> {
    let addr = format!("127.0.0.1:{local_port}");
    let deadline = Instant::now() + READY_TIMEOUT;

    loop {
        if let Ok(parsed) = addr.parse() {
            if TcpStream::connect_timeout(&parsed, Duration::from_millis(300)).is_ok() {
                return Ok(());
            }
        }

        if let Ok(Some(status)) = child.try_wait() {
            let tail = stderr_tail.lock().map(|g| g.clone()).unwrap_or_default();
            return Err(format!(
                "session-manager-plugin exited ({status}) before the tunnel was ready.{}",
                stderr_suffix(&tail),
            ));
        }

        if Instant::now() >= deadline {
            let tail = stderr_tail.lock().map(|g| g.clone()).unwrap_or_default();
            return Err(format!(
                "Timed out waiting for the SSM tunnel to open on 127.0.0.1:{local_port} after {}s.{}",
                READY_TIMEOUT.as_secs(),
                stderr_suffix(&tail),
            ));
        }

        thread::sleep(POLL_INTERVAL);
    }
}

fn stderr_suffix(tail: &str) -> String {
    if tail.trim().is_empty() {
        String::new()
    } else {
        format!(" session-manager-plugin stderr: {}", tail.trim())
    }
}

impl Drop for TunnelManager {
    fn drop(&mut self) {
        if let Ok(mut active) = self.active.lock() {
            for (_, mut handle) in active.drain() {
                let _ = handle.child.kill();
                let _ = handle.child.wait();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fake_session() -> StartSessionResult {
        StartSessionResult {
            session_id: "sess".into(),
            token_value: "tok".into(),
            stream_url: "wss://example".into(),
            request_params_json: "{}".into(),
        }
    }

    #[test]
    fn pick_free_local_port_returns_a_nonzero_port() {
        let port = TunnelManager::pick_free_local_port().expect("should find a free port");
        assert!(port > 0);
    }

    #[test]
    fn is_open_false_for_unknown_connection() {
        let manager = TunnelManager::new(PathBuf::from("does-not-matter"));
        assert!(!manager.is_open("nope"));
        assert_eq!(manager.local_port("nope"), None);
    }

    #[test]
    fn close_is_a_no_op_when_nothing_is_open() {
        let manager = TunnelManager::new(PathBuf::from("does-not-matter"));
        manager.close("nope"); // must not panic
    }

    #[test]
    fn open_fails_cleanly_when_plugin_binary_is_missing() {
        let manager = TunnelManager::new(PathBuf::from("this-binary-does-not-exist"));
        let result = manager.open("conn-1", &fake_session(), "us-east-1", "https://ssm.us-east-1.amazonaws.com", 15211);
        assert!(result.is_err());
        assert!(!manager.is_open("conn-1"));
    }

    fn spawn_long_lived_process() -> Child {
        let cmd = if cfg!(windows) { "cmd" } else { "sleep" };
        let args: &[&str] = if cfg!(windows) { &["/C", "timeout", "/T", "10", "/NOBREAK"] } else { &["10"] };
        Command::new(cmd)
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("should be able to spawn a placeholder process")
    }

    fn spawn_short_lived_process() -> Child {
        let cmd = if cfg!(windows) { "cmd" } else { "true" };
        let args: &[&str] = if cfg!(windows) { &["/C", "exit", "0"] } else { &[] };
        Command::new(cmd)
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("should be able to spawn a placeholder process")
    }

    #[test]
    fn wait_until_ready_returns_ok_once_port_is_listening() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        thread::spawn(move || {
            for stream in listener.incoming() {
                let _ = stream;
            }
        });

        let mut child = spawn_long_lived_process();
        let tail = Arc::new(Mutex::new(String::new()));
        let result = wait_until_ready(&mut child, port, &tail);
        let _ = child.kill();
        let _ = child.wait();

        assert!(result.is_ok(), "expected Ok, got {result:?}");
    }

    #[test]
    fn wait_until_ready_errors_when_child_exits_before_port_opens() {
        let port = TunnelManager::pick_free_local_port().unwrap(); // nothing ever listens here
        let mut child = spawn_short_lived_process();
        let _ = child.wait(); // ensure it has actually exited before polling
        let tail = Arc::new(Mutex::new(String::from("some diagnostic output")));

        let result = wait_until_ready(&mut child, port, &tail);

        assert!(result.is_err());
        let message = result.unwrap_err();
        assert!(message.contains("exited"), "message was: {message}");
        assert!(message.contains("some diagnostic output"), "message was: {message}");
    }
}
