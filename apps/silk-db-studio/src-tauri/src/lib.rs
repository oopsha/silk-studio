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
            jdbc_agent: Mutex::new(JdbcAgentClient::new(jdbc_agent_jar())),
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
