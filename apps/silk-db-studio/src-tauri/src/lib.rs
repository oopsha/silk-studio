mod secrets;

use serde_json::Value;
use silk_db_agent_client::JdbcAgentClient;
use std::path::PathBuf;
use tauri::Manager;
#[cfg(target_os = "windows")]
use tauri_plugin_window_controls::{TitleBarColors, WindowControlsExt};

#[cfg(target_os = "windows")]
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

    #[cfg(target_os = "macos")]
    {
        window.eval("document.documentElement.dataset.macOverlayTitlebar = 'true'")?;
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
    /// Interior-mutable / demuxed client — execute and cancel may run concurrently.
    jdbc_agent: JdbcAgentClient,
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

    state.jdbc_agent.execute_query(
        statement,
        max_rows,
        query_timeout_sec,
        auto_commit,
        read_only,
    )
}

#[tauri::command]
fn query_cancel(state: tauri::State<'_, AppState>) -> Result<Value, String> {
    state.jdbc_agent.cancel_query()
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
    state.jdbc_agent.connect(
        url.trim(),
        user.trim(),
        password.as_str(),
        schema.as_deref(),
        catalog.as_deref(),
    )
}

#[tauri::command]
fn connection_disconnect(state: tauri::State<'_, AppState>) -> Result<Value, String> {
    state.jdbc_agent.disconnect()
}

#[tauri::command]
fn connection_test(
    url: String,
    user: String,
    password: String,
    schema: Option<String>,
    catalog: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<Value, String> {
    state.jdbc_agent.test_connection(
        url.trim(),
        user.trim(),
        password.as_str(),
        schema.as_deref(),
        catalog.as_deref(),
    )
}

#[tauri::command]
fn connection_metadata(
    schema: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<Value, String> {
    state.jdbc_agent.list_metadata(schema.as_deref())
}

#[tauri::command]
fn connection_columns(
    schema: String,
    table: String,
    state: tauri::State<'_, AppState>,
) -> Result<Value, String> {
    state.jdbc_agent.list_columns(schema.trim(), table.trim())
}

#[tauri::command]
fn connection_primary_keys(
    schema: String,
    table: String,
    state: tauri::State<'_, AppState>,
) -> Result<Value, String> {
    state.jdbc_agent.list_primary_keys(schema.trim(), table.trim())
}

#[tauri::command]
fn connection_ddl(
    schema: String,
    name: String,
    kind: String,
    state: tauri::State<'_, AppState>,
) -> Result<Value, String> {
    state
        .jdbc_agent
        .fetch_object_ddl(schema.trim(), name.trim(), kind.trim())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            jdbc_agent: JdbcAgentClient::new(jdbc_agent_jar()),
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_system_symbols::init())
        .plugin(tauri_plugin_window_controls::init())
        .invoke_handler(tauri::generate_handler![
            ensure_title_bar_overlay,
            query_execute,
            query_cancel,
            connection_connect,
            connection_disconnect,
            connection_test,
            connection_metadata,
            connection_columns,
            connection_primary_keys,
            connection_ddl,
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
