mod window_layout;
mod archive;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_controls::init())
        .invoke_handler(tauri::generate_handler![
            archive::archive_list,
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
