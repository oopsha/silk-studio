use silk_window_state::WindowLayoutState;
use crate::launch::QuickMode;
use tauri::{AppHandle, State, WebviewWindow};

#[tauri::command]
pub fn window_layout_save(
    app: AppHandle,
    quick: State<'_, QuickMode>,
    layout: WindowLayoutState,
) -> Result<(), String> {
    if quick.0 {
        return Ok(()); // the small job window must not replace the saved layout
    }
    silk_window_state::window_layout_save(app, layout)
}

#[tauri::command]
pub fn window_layout_apply_and_show(
    app: AppHandle,
    quick: State<'_, QuickMode>,
    window: WebviewWindow,
    layout: WindowLayoutState,
) -> Result<(), String> {
    if quick.0 {
        return silk_window_state::window_layout_show(window);
    }
    silk_window_state::window_layout_apply_and_show(app, window, layout)
}

#[tauri::command]
pub fn window_layout_show(window: WebviewWindow) -> Result<(), String> {
    silk_window_state::window_layout_show(window)
}

#[tauri::command]
pub fn window_layout_load(app: AppHandle) -> Result<Option<WindowLayoutState>, String> {
    silk_window_state::window_layout_load(app)
}

#[tauri::command]
pub fn window_layout_file_exists(app: AppHandle) -> Result<bool, String> {
    silk_window_state::window_layout_file_exists(app)
}
