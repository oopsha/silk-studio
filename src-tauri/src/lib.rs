use tauri::Manager;
use tauri_plugin_window_controls::{TitleBarColors, WindowControlsExt};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_system_symbols::init())
        .plugin(tauri_plugin_window_controls::init())
        .setup(|app| {
            #[cfg(target_os = "windows")]
            if let Some(window) = app.get_webview_window("main") {
                let title_bar_colors = TitleBarColors {
                    default: Some("transparent".into()),
                    symbol: Some("#8c8c8c".into()),
                    hover: Some("#323233".into()),
                    pressed: Some("#3c3c3d".into()),
                    inactive: Some("transparent".into()),
                    ..Default::default()
                };

                // Colors/height must be set before overlay bootstrap reads globals.
                window.set_title_bar_height(32)?;
                window.set_title_bar_colors(
                    title_bar_colors.clone(),
                    title_bar_colors,
                )?;
                window.set_title_bar_overlay(true)?;

                window.eval("document.documentElement.dataset.wco = 'true'")?;
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
