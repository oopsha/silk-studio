mod archive;
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

#[tauri::command]
fn ensure_title_bar_overlay(window: tauri::WebviewWindow) -> Result<(), String> {
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
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_controls::init())
        .manage(archive::CreateTasks::default())
        .invoke_handler(tauri::generate_handler![
            archive::archive_list,
            archive::archive_create,
            archive::archive_cancel,
            archive::open_output_folder,
            file_sizes,
            draft_scan,
            ensure_title_bar_overlay,
            window_layout::window_layout_save,
            window_layout::window_layout_apply_and_show,
            window_layout::window_layout_show,
            window_layout::window_layout_file_exists,
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                configure_main_window(&window)?;
                silk_window_state::restore_main_window(app.handle(), &window);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Silk Zip");
}
