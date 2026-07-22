mod secrets;

use serde_json::Value;
use silk_db_agent_client::JdbcAgentClient;
use std::path::PathBuf;
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

fn jdbc_agent_jar() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..")
        .join("packages")
        .join("jdbc-agent")
        .join("build")
        .join("libs")
        .join("jdbc-agent-all.jar")
}

struct AppState {
    jdbc_agent: Mutex<JdbcAgentClient>,
}

#[tauri::command]
fn query_execute(
    sql: String,
    max_rows: Option<u32>,
    query_timeout_sec: Option<u32>,
    auto_commit: Option<bool>,
    read_only: Option<bool>,
    state: tauri::State<'_, AppState>,
) -> Result<Value, String> {
    let statement = sql.trim();
    if statement.is_empty() {
        return Err("Query is empty.".into());
    }

    let mut guard = state
        .jdbc_agent
        .lock()
        .map_err(|_| "Failed to acquire jdbc-agent lock".to_string())?;
    guard.execute_query(
        statement,
        max_rows,
        query_timeout_sec,
        auto_commit,
        read_only,
    )
}

#[tauri::command]
fn connection_connect(
    url: String,
    user: String,
    password: String,
    schema: Option<String>,
    catalog: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<Value, String> {
    let mut guard = state
        .jdbc_agent
        .lock()
        .map_err(|_| "Failed to acquire jdbc-agent lock".to_string())?;
    guard.connect(
        url.trim(),
        user.trim(),
        password.as_str(),
        schema.as_deref(),
        catalog.as_deref(),
    )
}

#[tauri::command]
fn connection_disconnect(state: tauri::State<'_, AppState>) -> Result<Value, String> {
    let mut guard = state
        .jdbc_agent
        .lock()
        .map_err(|_| "Failed to acquire jdbc-agent lock".to_string())?;
    guard.disconnect()
}

#[tauri::command]
fn connection_test(
    url: String,
    user: String,
    password: String,
    catalog: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<Value, String> {
    let mut guard = state
        .jdbc_agent
        .lock()
        .map_err(|_| "Failed to acquire jdbc-agent lock".to_string())?;
    guard.test_connection(url.trim(), user.trim(), password.as_str(), catalog.as_deref())
}

#[tauri::command]
fn connection_metadata(
    schema: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<Value, String> {
    let mut guard = state
        .jdbc_agent
        .lock()
        .map_err(|_| "Failed to acquire jdbc-agent lock".to_string())?;
    guard.list_metadata(schema.as_deref())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            jdbc_agent: Mutex::new(JdbcAgentClient::new(jdbc_agent_jar())),
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_system_symbols::init())
        .plugin(tauri_plugin_window_controls::init())
        .invoke_handler(tauri::generate_handler![
            ensure_title_bar_overlay,
            query_execute,
            connection_connect,
            connection_disconnect,
            connection_test,
            connection_metadata,
            secrets::secret_set,
            secrets::secret_get,
            secrets::secret_delete,
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
