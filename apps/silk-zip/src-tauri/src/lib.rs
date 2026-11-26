mod archive;
mod clipboard;
mod launch;
#[cfg(windows)]
mod shell_menu;
mod settings;
mod window_layout;

use tauri::Manager;
#[cfg(target_os = "windows")]
use tauri_plugin_window_controls::{TitleBarColors, WindowControlsExt};

fn configure_main_window(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    #[cfg(target_os = "windows")]
    {
        let colors = TitleBarColors {
            default: Some("transparent".into()),
            symbol: Some("#8c8c8c".into()),
            hover: Some("#323233".into()),
            pressed: Some("#3c3c3d".into()),
            inactive: Some("transparent".into()),
            ..Default::default()
        };
        window.set_title_bar_height(32)?;
        window.set_title_bar_colors(colors.clone(), colors)?;
        window.set_title_bar_overlay(true)?;
        window.eval("document.documentElement.dataset.wco = 'true'")?;
    }
    #[cfg(not(target_os = "windows"))]
    let _ = window;
    Ok(())
}

/// Moves a second window down and to the right of the saved position so it does not
/// cover the first one; near the screen edge it moves up and to the left instead.
fn cascade_window(window: &tauri::WebviewWindow) {
    if window.is_maximized().unwrap_or(false) {
        return;
    }
    let (Ok(position), Ok(size)) = (window.outer_position(), window.outer_size()) else {
        return;
    };
    let offset = (32.0 * window.scale_factor().unwrap_or(1.0)) as i32;
    let mut direction = 1;
    if let Ok(Some(monitor)) = window.current_monitor() {
        let area = monitor.position();
        let extent = monitor.size();
        let right = area.x + extent.width as i32;
        let bottom = area.y + extent.height as i32;
        if position.x + size.width as i32 + offset > right || position.y + size.height as i32 + offset > bottom {
            direction = -1;
        }
    }
    let _ = window.set_position(tauri::PhysicalPosition::new(
        position.x + direction * offset,
        position.y + direction * offset,
    ));
}

#[tauri::command]
fn ensure_title_bar_overlay(window: tauri::WebviewWindow, quick: tauri::State<'_, launch::QuickMode>) -> Result<(), String> {
    if quick.0 {
        return Ok(());
    }
    configure_main_window(&window).map_err(|error| error.to_string())
}

#[tauri::command]
fn file_sizes(paths: Vec<String>) -> Vec<(String, Option<u64>, bool)> {
    paths
        .into_iter()
        .filter_map(|path| {
            std::fs::metadata(&path).ok().map(|metadata| {
                let is_directory = metadata.is_dir();
                let size = metadata.is_file().then(|| metadata.len());
                (path, size, is_directory)
            })
        })
        .collect()
}

#[tauri::command]
async fn draft_scan(
    paths: Vec<String>,
) -> Result<Vec<(String, String, Option<u64>, bool)>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut result = Vec::new();
        let mut pending = Vec::new();
        for path in paths {
            let path = std::path::PathBuf::from(path);
            let name = path
                .file_name()
                .and_then(|v| v.to_str())
                .ok_or("항목 이름을 읽을 수 없습니다.")?
                .to_string();
            pending.push((path, name));
        }
        while let Some((path, name)) = pending.pop() {
            if result.len() >= 100_000 {
                return Err("최대 10만 개 항목까지 추가할 수 있습니다.".to_string());
            }
            let metadata = std::fs::symlink_metadata(&path)
                .map_err(|error| format!("{}: {error}", path.display()))?;
            if metadata.file_type().is_symlink() || (!metadata.is_file() && !metadata.is_dir()) {
                return Err("일반 파일과 폴더만 추가할 수 있습니다.".to_string());
            }
            if metadata.is_dir() {
                for child in std::fs::read_dir(&path).map_err(|error| error.to_string())? {
                    let child = child.map_err(|error| error.to_string())?;
                    let child_name = child
                        .file_name()
                        .into_string()
                        .map_err(|_| "파일 이름을 읽을 수 없습니다.")?;
                    pending.push((child.path(), format!("{name}/{child_name}")));
                }
            }
            result.push((
                path.to_string_lossy().into_owned(),
                name,
                metadata.is_file().then(|| metadata.len()),
                metadata.is_dir(),
            ));
        }
        Ok(result)
    })
    .await
    .map_err(|_| "추가할 항목을 읽지 못했습니다.".to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(windows)]
    if shell_menu::handle_args() {
        return;
    }
    let request = launch::from_environment();
    let quick = request.as_ref().is_some_and(|request| launch::is_quick(&request.action));
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_controls::init())
        .manage(archive::CreateTasks::default())
        .manage(archive::ConflictWaiters::default())
        .manage(launch::QuickMode(quick))
        .manage(launch::LaunchState(std::sync::Mutex::new(request)))
        .invoke_handler(tauri::generate_handler![
            archive::archive_list,
            archive::archive_create,
            archive::archive_extract,
            archive::archive_resolve_conflict,
            archive::archive_test,
            archive::archive_update,
            archive::archive_repair,
            archive::archive_progress_diagnostic,
            archive::archive_cancel,
            archive::open_output_folder,
            archive::open_install_folder,
            launch::take_launch_request,
            launch::unique_path,
            archive::new_window,
            archive::exit_app,
            archive::archive_save_as,
            settings::settings_load,
            settings::settings_save,
            clipboard::clipboard_prepare_dir,
            clipboard::clipboard_copy_dir,
            clipboard::clipboard_read_files,
            archive::is_elevated,
            archive::reveal_in_folder,
            file_sizes,
            draft_scan,
            ensure_title_bar_overlay,
            window_layout::window_layout_save,
            window_layout::window_layout_apply_and_show,
            window_layout::window_layout_show,
            window_layout::window_layout_file_exists,
            window_layout::window_layout_load,
        ])
        .setup(move |app| {
            if let Some(window) = app.get_webview_window("main") {
                // The small job window has no title bar buttons; the dialog's own close button is enough.
                if !quick {
                    configure_main_window(&window)?;
                }
                if archive::is_elevated() {
                    let _ = window.set_title("Silk Zip (관리자)");
                }
                if quick {
                    let _ = window.set_min_size(None::<tauri::Size>);
                    let _ = window.set_size(tauri::LogicalSize::new(460.0, 230.0));
                    let _ = window.center();
                    let _ = window.show();
                    let _ = window.set_focus();
                } else {
                    silk_window_state::restore_main_window(app.handle(), &window);
                }
                if !quick && std::env::args().any(|arg| arg == archive::NEW_WINDOW_ARG) {
                    cascade_window(&window);
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Silk Zip");
}
