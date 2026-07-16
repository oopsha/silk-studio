use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_window_controls::{TitleBarColors, WindowControlsExt};

fn title_bar_colors() -> TitleBarColors {
    TitleBarColors {
        default: Some("transparent".into()),
        symbol: Some("#8c8c8c".into()),
        hover: Some("#323233".into()),
        pressed: Some("#3c3c3d".into()),
        inactive: Some("transparent".into()),
        ..Default::default()
    }
}

fn configure_main_window(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    window.set_background_color(Some(tauri::window::Color(25, 26, 27, 255)))?;

    #[cfg(target_os = "windows")]
    {
        let colors = title_bar_colors();
        window.set_title_bar_height(32)?;
        window.set_title_bar_colors(colors.clone(), colors)?;
        window.set_title_bar_overlay(true)?;
        window.eval("document.documentElement.dataset.wco = 'true'")?;
    }

    Ok(())
}

#[tauri::command]
fn ensure_title_bar_overlay(window: tauri::WebviewWindow) -> Result<(), String> {
    configure_main_window(&window).map_err(|e| e.to_string())
}

struct AgentProcess {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    next_id: u64,
    connected: bool,
}

struct JdbcAgentClient {
    project_root: PathBuf,
    process: Option<AgentProcess>,
}

impl JdbcAgentClient {
    fn new() -> Self {
        Self {
            project_root: PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("..")
                .join("..")
                .join(".."),
            process: None,
        }
    }

    fn execute_query(&mut self, sql: &str) -> Result<Value, String> {
        self.ensure_connection()?;
        self.send_request("query.execute", json!({ "sql": sql }))
    }

    fn ensure_connection(&mut self) -> Result<(), String> {
        let process = self.ensure_process()?;
        if process.connected {
            return Ok(());
        }
        self.send_request("connection.open", json!({}))?;
        if let Some(process) = self.process.as_mut() {
            process.connected = true;
        }
        Ok(())
    }

    fn ensure_process(&mut self) -> Result<&mut AgentProcess, String> {
        if self.process.is_none() {
            let agent_jar = self
                .project_root
                .join("packages")
                .join("jdbc-agent")
                .join("build")
                .join("libs")
                .join("jdbc-agent-all.jar");

            if !agent_jar.exists() {
                return Err(format!(
                    "jdbc-agent is not built.\nBuild it first:\ncd {}\nWindows: .\\gradlew.bat build\nmacOS/Linux: ./gradlew build\nThen retry query execution.",
                    self.project_root.join("packages").join("jdbc-agent").display()
                ));
            }

            let mut child = Command::new("java")
                .arg("-Dfile.encoding=UTF-8")
                .arg("-Dsun.jnu.encoding=UTF-8")
                .arg("-jar")
                .arg(agent_jar)
                .arg("--serve")
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::inherit())
                .spawn()
                .map_err(|e| format!("Failed to start jdbc-agent: {e}"))?;

            let stdin = child
                .stdin
                .take()
                .ok_or_else(|| "Failed to capture jdbc-agent stdin".to_string())?;
            let stdout = child
                .stdout
                .take()
                .ok_or_else(|| "Failed to capture jdbc-agent stdout".to_string())?;

            self.process = Some(AgentProcess {
                child,
                stdin,
                stdout: BufReader::new(stdout),
                next_id: 1,
                connected: false,
            });
        }

        self.process
            .as_mut()
            .ok_or_else(|| "Failed to initialize jdbc-agent process".to_string())
    }

    fn send_request(&mut self, method: &str, params: Value) -> Result<Value, String> {
        let process = self.ensure_process()?;
        let id = process.next_id;
        process.next_id += 1;

        let request = json!({
            "id": id,
            "method": method,
            "params": params,
        });
        let payload = request.to_string();

        process
            .stdin
            .write_all(payload.as_bytes())
            .map_err(|e| format!("Failed to write request: {e}"))?;
        process
            .stdin
            .write_all(b"\n")
            .map_err(|e| format!("Failed to write request line ending: {e}"))?;
        process
            .stdin
            .flush()
            .map_err(|e| format!("Failed to flush request: {e}"))?;

        let mut line = String::new();
        let bytes = process
            .stdout
            .read_line(&mut line)
            .map_err(|e| format!("Failed to read response: {e}"))?;

        if bytes == 0 {
            self.process = None;
            return Err("jdbc-agent terminated unexpectedly.".into());
        }

        let response: Value = serde_json::from_str(line.trim())
            .map_err(|e| format!("Invalid response JSON from jdbc-agent: {e}"))?;

        let response_id = response
            .get("id")
            .and_then(Value::as_u64)
            .ok_or_else(|| "Invalid response: missing id".to_string())?;
        if response_id != id {
            return Err(format!(
                "Mismatched response id. expected={id}, actual={response_id}"
            ));
        }

        let ok = response
            .get("ok")
            .and_then(Value::as_bool)
            .ok_or_else(|| "Invalid response: missing ok".to_string())?;
        if !ok {
            let message = response
                .get("error")
                .and_then(|v| v.get("message"))
                .and_then(Value::as_str)
                .unwrap_or("Unknown jdbc-agent error");
            return Err(message.to_string());
        }

        Ok(response.get("result").cloned().unwrap_or_else(|| json!({})))
    }
}

impl Drop for JdbcAgentClient {
    fn drop(&mut self) {
        if let Some(mut process) = self.process.take() {
            let _ = process
                .stdin
                .write_all(br#"{"id":0,"method":"agent.shutdown","params":{}}"#);
            let _ = process.stdin.write_all(b"\n");
            let _ = process.stdin.flush();
            let _ = process.child.kill();
            let _ = process.child.wait();
        }
    }
}

struct AppState {
    jdbc_agent: Mutex<JdbcAgentClient>,
}

#[tauri::command]
fn query_execute(sql: String, state: tauri::State<'_, AppState>) -> Result<Value, String> {
    let statement = sql.trim();
    if statement.is_empty() {
        return Err("Query is empty.".into());
    }

    let mut guard = state
        .jdbc_agent
        .lock()
        .map_err(|_| "Failed to acquire jdbc-agent lock".to_string())?;
    guard.execute_query(statement)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            jdbc_agent: Mutex::new(JdbcAgentClient::new()),
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_system_symbols::init())
        .plugin(tauri_plugin_window_controls::init())
        .invoke_handler(tauri::generate_handler![
            ensure_title_bar_overlay,
            query_execute
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                configure_main_window(&window)?;
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
