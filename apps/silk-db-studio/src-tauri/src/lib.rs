mod ai_http;
mod app_log;
mod open_external;
mod runtime_paths;
mod secrets;
mod ssh_tunnel;
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

/// Runs `f` on Tauri's blocking-task pool instead of inline on the IPC-dispatch thread.
///
/// A plain (non-`async`) `#[tauri::command]` fn is invoked *synchronously, inline* by Tauri's
/// generated wrapper (`tauri-macros`' `body_blocking` calls the function directly, no
/// `spawn_blocking` involved) — so a command that can take a long time (a slow/retrying JDBC
/// connect, a long-running query) blocks whatever thread is running IPC dispatch for as long as
/// it takes. On Windows this manifests as the whole window going "Not Responding" (spinning
/// cursor, DWM ghosting) the moment the user clicks anywhere else, because that thread stops
/// pumping window messages. Wrapping the actual blocking call in this helper and making the
/// command itself `async` routes it through Tauri's async command path instead, which awaits a
/// real `tauri::async_runtime::spawn_blocking` future rather than running inline.
async fn run_blocking<F, T>(f: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|error| format!("Background task failed: {error}"))?
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
async fn query_execute_paged(
    connection_id: String,
    sql: String,
    known_columns: Vec<String>,
    offset: u32,
    limit: u32,
    filters: Option<Vec<Value>>,
    sort: Option<Vec<Value>>,
    query_timeout_sec: Option<u32>,
    auto_commit: Option<bool>,
    read_only: Option<bool>,
    binds: Option<Vec<Option<String>>>,
    app: tauri::AppHandle,
) -> Result<Value, String> {
    require_connection_id(&connection_id)?;
    let statement = sql.trim().to_string();
    if statement.is_empty() {
        return Err("Query is empty.".into());
    }

    run_blocking(move || {
        let state = app.state::<AppState>();
        state.jdbc_agent.execute_query_paged(
            &connection_id,
            &statement,
            &known_columns,
            offset,
            limit,
            filters,
            sort,
            query_timeout_sec,
            auto_commit,
            read_only,
            binds.as_deref(),
        )
    })
    .await
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
async fn connection_connect(
    connection_id: String,
    url: String,
    user: String,
    password: String,
    schema: Option<String>,
    catalog: Option<String>,
    app: tauri::AppHandle,
) -> Result<Value, String> {
    require_connection_id(&connection_id)?;
    run_blocking(move || {
        let state = app.state::<AppState>();
        state.jdbc_agent.connect(
            &connection_id,
            url.trim(),
            user.trim(),
            password.as_str(),
            schema.as_deref(),
            catalog.as_deref(),
        )
    })
    .await
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
async fn connection_test(
    url: String,
    user: String,
    password: String,
    schema: Option<String>,
    catalog: Option<String>,
    app: tauri::AppHandle,
) -> Result<Value, String> {
    run_blocking(move || {
        let state = app.state::<AppState>();
        state.jdbc_agent.test_connection(
            url.trim(),
            user.trim(),
            password.as_str(),
            schema.as_deref(),
            catalog.as_deref(),
        )
    })
    .await
}

#[tauri::command]
fn connection_metadata(
    connection_id: String,
    schema: Option<String>,
    catalog: Option<String>,
    include_secondary_kinds: Option<bool>,
    state: tauri::State<'_, AppState>,
) -> Result<Value, String> {
    let connection_id = require_connection_id(&connection_id)?;
    state.jdbc_agent.list_metadata(
        connection_id,
        schema.as_deref(),
        catalog.as_deref(),
        include_secondary_kinds,
    )
}

#[tauri::command]
fn connection_prefetch_catalog(
    connection_id: String,
    catalog: Option<String>,
    max_objects: Option<u32>,
    state: tauri::State<'_, AppState>,
) -> Result<Value, String> {
    let connection_id = require_connection_id(&connection_id)?;
    state
        .jdbc_agent
        .prefetch_catalog(connection_id, catalog.as_deref(), max_objects)
}

/// Loops every catalog on catalog-explorer dialects (SQL Server) server-side (jdbc-agent), so
/// this can take a few seconds on an instance with many databases — `async` + `run_blocking`
/// for the same reason `connection_connect`/`connection_test` are (see that doc comment).
#[tauri::command]
async fn connection_find_objects_by_name(
    connection_id: String,
    name: String,
    contains: Option<bool>,
    kinds: Option<Vec<String>>,
    include_system_objects: Option<bool>,
    app: tauri::AppHandle,
) -> Result<Value, String> {
    require_connection_id(&connection_id)?;
    run_blocking(move || {
        let state = app.state::<AppState>();
        state.jdbc_agent.find_objects_by_name(
            &connection_id,
            &name,
            contains,
            kinds,
            include_system_objects,
        )
    })
    .await
}

#[tauri::command]
fn connection_columns(
    connection_id: String,
    schema: String,
    table: String,
    catalog: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<Value, String> {
    let connection_id = require_connection_id(&connection_id)?;
    state.jdbc_agent.list_columns(
        connection_id,
        schema.trim(),
        table.trim(),
        catalog.as_deref(),
    )
}

#[tauri::command]
fn connection_arguments(
    connection_id: String,
    schema: String,
    name: String,
    kind: String,
    catalog: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<Value, String> {
    let connection_id = require_connection_id(&connection_id)?;
    state.jdbc_agent.list_arguments(
        connection_id,
        schema.trim(),
        name.trim(),
        kind.trim(),
        catalog.as_deref(),
    )
}

#[tauri::command]
fn connection_package_members(
    connection_id: String,
    schema: String,
    package: String,
    catalog: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<Value, String> {
    let connection_id = require_connection_id(&connection_id)?;
    state.jdbc_agent.list_package_members(
        connection_id,
        schema.trim(),
        package.trim(),
        catalog.as_deref(),
    )
}

#[tauri::command]
fn connection_primary_keys(
    connection_id: String,
    schema: String,
    table: String,
    catalog: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<Value, String> {
    let connection_id = require_connection_id(&connection_id)?;
    state.jdbc_agent.list_primary_keys(
        connection_id,
        schema.trim(),
        table.trim(),
        catalog.as_deref(),
    )
}

#[tauri::command]
fn connection_indexes(
    connection_id: String,
    schema: String,
    table: String,
    catalog: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<Value, String> {
    let connection_id = require_connection_id(&connection_id)?;
    state.jdbc_agent.list_indexes(
        connection_id,
        schema.trim(),
        table.trim(),
        catalog.as_deref(),
    )
}

#[tauri::command]
fn connection_table_comment(
    connection_id: String,
    schema: String,
    table: String,
    catalog: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<Value, String> {
    let connection_id = require_connection_id(&connection_id)?;
    state.jdbc_agent.get_table_comment(
        connection_id,
        schema.trim(),
        table.trim(),
        catalog.as_deref(),
    )
}

#[tauri::command]
fn connection_foreign_keys(
    connection_id: String,
    schema: String,
    table: String,
    catalog: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<Value, String> {
    let connection_id = require_connection_id(&connection_id)?;
    state.jdbc_agent.list_foreign_keys(
        connection_id,
        schema.trim(),
        table.trim(),
        catalog.as_deref(),
    )
}

#[tauri::command]
fn connection_references(
    connection_id: String,
    schema: String,
    table: String,
    catalog: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<Value, String> {
    let connection_id = require_connection_id(&connection_id)?;
    state.jdbc_agent.list_references(
        connection_id,
        schema.trim(),
        table.trim(),
        catalog.as_deref(),
    )
}

#[tauri::command]
fn connection_constraints(
    connection_id: String,
    schema: String,
    table: String,
    catalog: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<Value, String> {
    let connection_id = require_connection_id(&connection_id)?;
    state.jdbc_agent.list_constraints(
        connection_id,
        schema.trim(),
        table.trim(),
        catalog.as_deref(),
    )
}

#[tauri::command]
fn connection_triggers(
    connection_id: String,
    schema: String,
    table: String,
    catalog: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<Value, String> {
    let connection_id = require_connection_id(&connection_id)?;
    state.jdbc_agent.list_triggers(
        connection_id,
        schema.trim(),
        table.trim(),
        catalog.as_deref(),
    )
}

#[tauri::command]
async fn connection_ddl(
    connection_id: String,
    schema: String,
    name: String,
    kind: String,
    package_body: Option<bool>,
    catalog: Option<String>,
    app: tauri::AppHandle,
) -> Result<Value, String> {
    require_connection_id(&connection_id)?;
    run_blocking(move || {
        let state = app.state::<AppState>();
        state.jdbc_agent.fetch_object_ddl(
            &connection_id,
            &schema,
            &name,
            &kind,
            package_body,
            catalog.as_deref(),
        )
    })
    .await
}

#[tauri::command]
fn connection_compile(
    connection_id: String,
    schema: String,
    name: String,
    kind: String,
    package_body: Option<bool>,
    catalog: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<Value, String> {
    let connection_id = require_connection_id(&connection_id)?;
    state.jdbc_agent.compile_object(
        connection_id,
        schema.trim(),
        name.trim(),
        kind.trim(),
        package_body,
        catalog.as_deref(),
    )
}

#[tauri::command]
fn connection_dependencies(
    connection_id: String,
    schema: String,
    name: String,
    kind: String,
    package_body: Option<bool>,
    catalog: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<Value, String> {
    let connection_id = require_connection_id(&connection_id)?;
    state.jdbc_agent.list_object_dependencies(
        connection_id,
        schema.trim(),
        name.trim(),
        kind.trim(),
        package_body,
        catalog.as_deref(),
    )
}

#[tauri::command]
fn connection_dependents(
    connection_id: String,
    schema: String,
    name: String,
    kind: String,
    package_body: Option<bool>,
    catalog: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<Value, String> {
    let connection_id = require_connection_id(&connection_id)?;
    state.jdbc_agent.list_object_dependents(
        connection_id,
        schema.trim(),
        name.trim(),
        kind.trim(),
        package_body,
        catalog.as_deref(),
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
            query_execute_paged,
            query_cancel,
            connection_commit,
            connection_rollback,
            connection_set_catalog,
            connection_connect,
            connection_disconnect,
            connection_test,
            connection_metadata,
            connection_prefetch_catalog,
            connection_find_objects_by_name,
            connection_columns,
            connection_arguments,
            connection_package_members,
            connection_primary_keys,
            connection_indexes,
            connection_table_comment,
            connection_references,
            connection_foreign_keys,
            connection_constraints,
            connection_triggers,
            connection_ddl,
            connection_compile,
            connection_dependencies,
            connection_dependents,
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
            ssh_tunnel::ssh_tunnel_open,
            ssh_tunnel::ssh_tunnel_close,
            ssh_tunnel::ssh_tunnel_status,
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
            // jdbc-agent's own stderr (JVM crash traces, uncaught driver errors) was previously
            // inherited straight from this process — invisible in a packaged GUI build with no
            // console. Redirect it to its own log file so a future jdbc-agent crash leaves
            // something to diagnose instead of just "Broken pipe" on the next request.
            let jdbc_agent_log = app_log::app_data_logs_dir(app.handle())
                .ok()
                .map(|dir| dir.join("jdbc-agent.log"));
            app.manage(AppState {
                jdbc_agent: JdbcAgentClient::new(
                    paths.agent_jar.clone(),
                    paths.java_bin.clone(),
                    jdbc_agent_log,
                ),
            });
            // A leftover session-manager-plugin.exe at our exact bundled path can only be an
            // orphan from a previous run of this same app (crashed, force-killed, or closed
            // before the exit-requested handler below got to run) — see
            // `kill_orphaned_plugin_processes`'s doc comment. Sweep it before opening any
            // tunnel of our own so it doesn't keep locking its own .exe file indefinitely.
            ssm_tunnel_client::TunnelManager::kill_orphaned_plugin_processes(
                &paths.ssm_plugin_bin,
            );
            app.manage(ssm_tunnel::SsmTunnelState {
                tunnels: ssm_tunnel_client::TunnelManager::new(paths.ssm_plugin_bin.clone()),
            });
            app.manage(ssh_tunnel::SshTunnelState {
                tunnels: ssh_tunnel_client::TunnelManager::new(),
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
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // Kills jdbc-agent's Java subprocess and any open SSM/SSH tunnel subprocesses
            // before the app actually exits. Necessary because Tauri's runloop terminates the
            // process without unwinding through normal Rust drops on window close — the `Drop`
            // impls on these types (which do the same kill+wait) never get a chance to run
            // otherwise, leaving orphaned `session-manager-plugin.exe`/`java` processes behind
            // (confirmed: an orphaned session-manager-plugin.exe holds a lock on its own .exe,
            // which then blocks a later `cargo build` from touching it).
            if let tauri::RunEvent::ExitRequested { .. } = event {
                if let Some(state) = app_handle.try_state::<AppState>() {
                    state.jdbc_agent.shutdown();
                }
                if let Some(state) = app_handle.try_state::<ssm_tunnel::SsmTunnelState>() {
                    state.tunnels.close_all();
                }
                if let Some(state) = app_handle.try_state::<ssh_tunnel::SshTunnelState>() {
                    state.tunnels.close_all();
                }
            }
        });
}
