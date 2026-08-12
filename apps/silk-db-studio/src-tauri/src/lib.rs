mod ai_http;
mod app_log;
mod open_external;
mod runtime_paths;
mod secrets;
mod ssm_tunnel;
mod window_layout;

use serde_json::Value;
use silk_db_agent_client::JdbcAgentClient;
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

struct AppState {
    /// Interior-mutable / demuxed client — execute and cancel may run concurrently.
    jdbc_agent: JdbcAgentClient,
}

fn require_connection_id(connection_id: &str) -> Result<&str, String> {
    let trimmed = connection_id.trim();
    if trimmed.is_empty() {
        return Err("connectionId is required.".into());
    }
    Ok(trimmed)
}

#[tauri::command]
fn query_execute(
    connection_id: String,
    sql: String,
    max_rows: Option<u32>,
    query_timeout_sec: Option<u32>,
    auto_commit: Option<bool>,
    read_only: Option<bool>,
    binds: Option<Vec<Option<String>>>,
    state: tauri::State<'_, AppState>,
) -> Result<Value, String> {
    let connection_id = require_connection_id(&connection_id)?;
    let statement = sql.trim();
    if statement.is_empty() {
        return Err("Query is empty.".into());
    }

    state.jdbc_agent.execute_query(
        connection_id,
        statement,
        max_rows,
        query_timeout_sec,
        auto_commit,
        read_only,
        binds.as_deref(),
    )
}

#[tauri::command]
fn query_cancel(
    connection_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Value, String> {
    let connection_id = require_connection_id(&connection_id)?;
    state.jdbc_agent.cancel_query(connection_id)
}

#[tauri::command]
fn connection_commit(
    connection_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Value, String> {
    let connection_id = require_connection_id(&connection_id)?;
    state.jdbc_agent.commit_connection(connection_id)
}

#[tauri::command]
fn connection_rollback(
    connection_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Value, String> {
    let connection_id = require_connection_id(&connection_id)?;
    state.jdbc_agent.rollback_connection(connection_id)
}

#[tauri::command]
fn connection_set_catalog(
    connection_id: String,
    catalog: String,
    state: tauri::State<'_, AppState>,
) -> Result<Value, String> {
    let connection_id = require_connection_id(&connection_id)?;
    let catalog = catalog.trim();
    if catalog.is_empty() {
        return Err("catalog is required.".into());
    }
    state.jdbc_agent.set_catalog(connection_id, catalog)
}

#[tauri::command]
fn connection_connect(
    connection_id: String,
    url: String,
    user: String,
    password: String,
    schema: Option<String>,
    catalog: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<Value, String> {
    let connection_id = require_connection_id(&connection_id)?;
    state.jdbc_agent.connect(
        connection_id,
        url.trim(),
        user.trim(),
        password.as_str(),
        schema.as_deref(),
        catalog.as_deref(),
    )
}

#[tauri::command]
fn connection_disconnect(
    connection_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Value, String> {
    let connection_id = require_connection_id(&connection_id)?;
    state.jdbc_agent.disconnect(connection_id)
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
    connection_id: String,
    schema: Option<String>,
    catalog: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<Value, String> {
    let connection_id = require_connection_id(&connection_id)?;
    state
        .jdbc_agent
        .list_metadata(connection_id, schema.as_deref(), catalog.as_deref())
}

#[tauri::command]
fn connection_columns(
    connection_id: String,
    schema: String,
    table: String,
    state: tauri::State<'_, AppState>,
) -> Result<Value, String> {
    let connection_id = require_connection_id(&connection_id)?;
    state
        .jdbc_agent
        .list_columns(connection_id, schema.trim(), table.trim())
}

#[tauri::command]
fn connection_package_members(
    connection_id: String,
    schema: String,
    package: String,
    state: tauri::State<'_, AppState>,
) -> Result<Value, String> {
    let connection_id = require_connection_id(&connection_id)?;
    state.jdbc_agent.list_package_members(
        connection_id,
        schema.trim(),
        package.trim(),
    )
}

#[tauri::command]
fn connection_primary_keys(
    connection_id: String,
    schema: String,
    table: String,
    state: tauri::State<'_, AppState>,
) -> Result<Value, String> {
    let connection_id = require_connection_id(&connection_id)?;
    state
        .jdbc_agent
        .list_primary_keys(connection_id, schema.trim(), table.trim())
}

#[tauri::command]
fn connection_ddl(
    connection_id: String,
    schema: String,
    name: String,
    kind: String,
    package_body: Option<bool>,
    state: tauri::State<'_, AppState>,
) -> Result<Value, String> {
    let connection_id = require_connection_id(&connection_id)?;
    state.jdbc_agent.fetch_object_ddl(
        connection_id,
        schema.trim(),
        name.trim(),
        kind.trim(),
        package_body,
    )
}

#[tauri::command]
fn connection_compile(
    connection_id: String,
    schema: String,
    name: String,
    kind: String,
    package_body: Option<bool>,
    state: tauri::State<'_, AppState>,
) -> Result<Value, String> {
    let connection_id = require_connection_id(&connection_id)?;
    state.jdbc_agent.compile_object(
        connection_id,
        schema.trim(),
        name.trim(),
        kind.trim(),
        package_body,
    )
}

#[tauri::command]
fn connection_dependencies(
    connection_id: String,
    schema: String,
    name: String,
    kind: String,
    package_body: Option<bool>,
    state: tauri::State<'_, AppState>,
) -> Result<Value, String> {
    let connection_id = require_connection_id(&connection_id)?;
    state.jdbc_agent.list_object_dependencies(
        connection_id,
        schema.trim(),
        name.trim(),
        kind.trim(),
        package_body,
    )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(app_log::AppLogState::new())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_system_symbols::init())
        .plugin(tauri_plugin_window_controls::init())
        .invoke_handler(tauri::generate_handler![
            ensure_title_bar_overlay,
            query_execute,
            query_cancel,
            connection_commit,
            connection_rollback,
            connection_set_catalog,
            connection_connect,
            connection_disconnect,
            connection_test,
            connection_metadata,
            connection_columns,
            connection_package_members,
            connection_primary_keys,
            connection_ddl,
            connection_compile,
            connection_dependencies,
            secrets::secret_set,
            secrets::secret_get,
            secrets::secret_delete,
            secrets::ai_secret_set,
            secrets::ai_secret_get,
            secrets::ai_secret_delete,
            ssm_tunnel::ssm_sso_start_login,
            ssm_tunnel::ssm_sso_poll_login,
            ssm_tunnel::ssm_sso_is_signed_in,
            ssm_tunnel::ssm_list_instances,
            ssm_tunnel::ssm_tunnel_open,
            ssm_tunnel::ssm_tunnel_close,
            ssm_tunnel::ssm_tunnel_status,
            ai_http::ai_http_fetch,
            open_external::open_external_url,
            window_layout::window_layout_save,
            window_layout::window_layout_apply_and_show,
            window_layout::window_layout_show,
            window_layout::window_layout_file_exists,
            app_log::app_log_write,
            app_log::app_runtime_info,
            app_log::app_log_open_folder,
        ])
        .setup(|app| {
            let paths = runtime_paths::resolve_runtime_paths(app.handle());
            app.manage(app_log::ManagedRuntimePaths(paths.clone()));
            app.manage(AppState {
                jdbc_agent: JdbcAgentClient::new(
                    paths.agent_jar.clone(),
                    paths.java_bin.clone(),
                ),
            });
            app.manage(ssm_tunnel::SsmTunnelState {
                tunnels: ssm_tunnel_client::TunnelManager::new(paths.ssm_plugin_bin.clone()),
            });

            let handle = app.handle().clone();
            {
                let log_state = app.state::<app_log::AppLogState>();
                app_log::write_startup_banner(&handle, &log_state, &paths);
            }

            if let Err(error) = runtime_paths::smoke_check(&paths) {
                let log_state = app.state::<app_log::AppLogState>();
                let _ = app_log::append_startup_warning(&handle, &log_state, &error);
            }

            if let Some(window) = app.get_webview_window("main") {
                // Overlay/chrome first so restore measures the final frame metrics.
                configure_main_window(&window)?;
                // Always restore (if possible) then show — never leave visible:false stuck.
                window_layout::restore_main_window(app.handle(), &window);
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
