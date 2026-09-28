mod startup_theme;
mod window_layout;

use tauri::Manager;
#[cfg(target_os = "windows")]
use tauri_plugin_window_controls::{TitleBarColors, WindowControlsExt};

#[cfg(target_os = "windows")]
fn title_bar_colors(theme: &startup_theme::StartupTheme) -> TitleBarColors {
    TitleBarColors {
        default: Some("transparent".into()),
        symbol: Some(theme.foreground_color.clone()),
        hover: Some(theme.hover_background.clone()),
        pressed: Some(theme.pressed_background.clone()),
        inactive: Some("transparent".into()),
        ..Default::default()
    }
}

fn configure_main_window(
    window: &tauri::WebviewWindow,
    theme: &startup_theme::StartupTheme,
) -> tauri::Result<()> {
    let rgb = u32::from_str_radix(theme.background_color.trim_start_matches('#'), 16).unwrap_or(0x191a1b);
    window.set_background_color(Some(tauri::window::Color(
        ((rgb >> 16) & 0xff) as u8,
        ((rgb >> 8) & 0xff) as u8,
        (rgb & 0xff) as u8,
        255,
    )))?;
    #[cfg(target_os = "windows")]
    {
        let colors = title_bar_colors(theme);
        window.set_title_bar_height(32)?;
        window.set_title_bar_colors(colors.clone(), colors)?;
        window.set_title_bar_overlay(true)?;
        window.eval("document.documentElement.dataset.wco = 'true'")?;
    }
    #[cfg(target_os = "macos")]
    window.eval("document.documentElement.dataset.macOverlayTitlebar = 'true'")?;
    Ok(())
}

#[tauri::command]
fn ensure_title_bar_overlay(window: tauri::WebviewWindow) -> Result<(), String> {
    let theme = startup_theme::load(&window.app_handle());
    configure_main_window(&window, &theme).map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_window_controls::init())
        .invoke_handler(tauri::generate_handler![
            ensure_title_bar_overlay,
            startup_theme::startup_theme_save,
            window_layout::window_layout_save,
            window_layout::window_layout_apply_and_show,
            window_layout::window_layout_show,
            window_layout::window_layout_file_exists,
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let theme = startup_theme::load(app.handle());
                configure_main_window(&window, &theme)?;
                silk_window_state::restore_main_window(app.handle(), &window);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Silk BE Studio");
}
