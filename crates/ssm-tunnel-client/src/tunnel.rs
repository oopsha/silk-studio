//! Per-connection `session-manager-plugin` subprocess lifecycle. Unlike the shared
//! jdbc-agent JVM singleton, each SSM tunnel targets a possibly-different instance/region,
//! so tunnels are tracked per `connectionId` in a map rather than as one shared process.

use crate::ssm_api::StartSessionResult;
use serde_json::json;
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// Prevents a console window from flashing up for the spawned plugin on Windows —
/// this is a GUI app with no console of its own to inherit into.
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// How long to wait for the plugin to signal it's ready before giving up. The plugin has to
/// open a WebSocket to AWS and complete the SSM handshake first, so this is not instantaneous
/// — but a JDBC connect attempt that races ahead of it fails with a confusing "no listener" (or
/// worse, a connect-then-immediately-EOF) error instead of a clear tunnel-startup error.
const READY_TIMEOUT: Duration = Duration::from_secs(15);
const POLL_INTERVAL: Duration = Duration::from_millis(100);

/// Substring of the line `session-manager-plugin` prints to stdout once its local listener is
/// bound and it's ready to accept connections (confirmed in the plugin's own source, the
/// `AWS-StartPortForwardingSession*` session handlers). Deliberately NOT a TCP probe-connect —
/// `AWS-StartPortForwardingSessionToRemoteHost` sessions only reliably support one forwarded
/// connection at a time, and probing by opening-then-dropping a raw TCP connection was
/// interfering with the real connection made right after (surfaced as Oracle's ORA-17800 /
/// "got -1 from a read call", i.e. the real connection being torn down almost immediately).
const READY_MARKER: &str = "Waiting for connections";

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

    /// Kills any already-running instance of our bundled `session-manager-plugin.exe`, matched
    /// by exact executable path — call once at app startup (see `lib.rs`'s `.setup()`), before
    /// this process opens any tunnel of its own. A process at that exact path can only be a
    /// leftover from a *previous* run of this same app: this app is the only thing that ever
    /// spawns it, so if we're just starting up, whatever we find here already lost its parent.
    /// This is the app's actual defense against orphaned plugin processes, since the "normal"
    /// defenses (the exit-requested handler calling `close_all`, and `Drop`) both only run on a
    /// clean shutdown — a force-killed or crashed previous run skips both.
    pub fn kill_orphaned_plugin_processes(plugin_bin: &Path) {
        let mut system = sysinfo::System::new();
        system.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
        for process in system.processes().values() {
            if process.exe() == Some(plugin_bin) {
                process.kill();
            }
        }
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
        let mut command = Command::new(&self.plugin_bin);
        command
            .arg(session_json)
            .arg(region)
            .arg("StartSession")
            .arg("")
            .arg(&session.request_params_json)
            .arg(endpoint)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(target_os = "windows")]
        command.creation_flags(CREATE_NO_WINDOW);
        let mut child = command
            .spawn()
            .map_err(|e| format!("Failed to spawn session-manager-plugin: {e}"))?;

        // Drain stdout/stderr on background threads (the plugin can block writing to a full
        // pipe otherwise). stdout is watched for the readiness marker; stderr's tail is kept
        // around purely for diagnostics if readiness fails or times out.
        let ready = Arc::new(AtomicBool::new(false));
        let stderr_tail = Arc::new(Mutex::new(String::new()));
        if let Some(stdout) = child.stdout.take() {
            let ready = Arc::clone(&ready);
            thread::spawn(move || {
                for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                    if line.contains(READY_MARKER) {
                        ready.store(true, Ordering::SeqCst);
                    }
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

        if let Err(error) = wait_until_ready(&mut child, &ready, &stderr_tail) {
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

    /// Kills every open tunnel — called from the app's exit-requested handler (see `lib.rs`'s
    /// `run()`) so plugin subprocesses don't outlive a window-close/quit. `Drop` alone isn't
    /// enough: Tauri's runloop doesn't unwind through normal Rust drops on window close, so
    /// this must be invoked explicitly before the process actually exits.
    pub fn close_all(&self) {
        if let Ok(mut active) = self.active.lock() {
            for (_, mut handle) in active.drain() {
                let _ = handle.child.kill();
                let _ = handle.child.wait();
            }
        }
    }

    pub fn is_open(&self, connection_id: &str) -> bool {
        self.active.lock().unwrap().contains_key(connection_id)
    }

    pub fn local_port(&self, connection_id: &str) -> Option<u16> {
        self.active.lock().unwrap().get(connection_id).map(|h| h.local_port)
    }
}

/// Polls `ready` (set by the stdout-watching thread once the plugin prints [`READY_MARKER`])
/// until it flips true, the child process exits, or `READY_TIMEOUT` elapses.
fn wait_until_ready(
    child: &mut Child,
    ready: &Arc<AtomicBool>,
    stderr_tail: &Arc<Mutex<String>>,
) -> Result<(), String> {
    let deadline = Instant::now() + READY_TIMEOUT;

    loop {
        if ready.load(Ordering::SeqCst) {
            return Ok(());
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
                "Timed out waiting for the SSM tunnel to become ready after {}s.{}",
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
        self.close_all();
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
    fn wait_until_ready_returns_ok_once_marker_flag_is_set() {
        // Mirrors what the stdout-watching thread in `open()` does — set the flag directly
        // rather than spawning a process that prints the marker, to keep this test fast and
        // not depend on shell-quoting the exact marker string across platforms.
        let mut child = spawn_long_lived_process();
        let ready = Arc::new(AtomicBool::new(false));
        let ready_setter = Arc::clone(&ready);
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(50));
            ready_setter.store(true, Ordering::SeqCst);
        });
        let tail = Arc::new(Mutex::new(String::new()));

        let result = wait_until_ready(&mut child, &ready, &tail);
        let _ = child.kill();
        let _ = child.wait();

        assert!(result.is_ok(), "expected Ok, got {result:?}");
    }

    #[test]
    fn wait_until_ready_errors_when_child_exits_before_marker_is_seen() {
        let mut child = spawn_short_lived_process();
        let _ = child.wait(); // ensure it has actually exited before polling
        let ready = Arc::new(AtomicBool::new(false)); // never set
        let tail = Arc::new(Mutex::new(String::from("some diagnostic output")));

        let result = wait_until_ready(&mut child, &ready, &tail);

        assert!(result.is_err());
        let message = result.unwrap_err();
        assert!(message.contains("exited"), "message was: {message}");
        assert!(message.contains("some diagnostic output"), "message was: {message}");
    }
}
