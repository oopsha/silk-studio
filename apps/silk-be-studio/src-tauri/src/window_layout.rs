use silk_window_state::WindowLayoutState;
use tauri::{AppHandle, WebviewWindow};

#[tauri::command]
pub fn window_layout_save(app: AppHandle, layout: WindowLayoutState) -> Result<(), String> {
    silk_window_state::window_layout_save(app, layout)
}

#[tauri::command]
pub fn window_layout_apply_and_show(
    app: AppHandle,
    window: WebviewWindow,
    layout: WindowLayoutState,
) -> Result<(), String> {
    silk_window_state::window_layout_apply_and_show(app, window, layout)
}

#[tauri::command]
pub fn window_layout_show(window: WebviewWindow) -> Result<(), String> {
    silk_window_state::window_layout_show(window)
}

#[tauri::command]
pub fn window_layout_file_exists(app: AppHandle) -> Result<bool, String> {
    silk_window_state::window_layout_file_exists(app)
}
