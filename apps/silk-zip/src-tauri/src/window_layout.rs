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
        return window_layout_show(quick, window);
    }
    silk_window_state::window_layout_apply_and_show(app, window, layout)
}

#[tauri::command]
pub fn window_layout_show(quick: State<'_, QuickMode>, window: WebviewWindow) -> Result<(), String> {
    if quick.1.load(std::sync::atomic::Ordering::SeqCst) {
        return Ok(()); // shown by `show_job_window` once there is something to see
    }
    silk_window_state::window_layout_show(window)
}

/// Shows the job window the first time; later calls (and calls outside quick mode) do nothing.
/// Showing it earlier flashes an unpainted (black) window and then the main screen.
#[tauri::command]
pub fn show_job_window(quick: State<'_, QuickMode>, window: WebviewWindow) -> Result<(), String> {
    if !quick.1.swap(false, std::sync::atomic::Ordering::SeqCst) {
        return Ok(());
    }
    let _ = window.center();
    window.show().map_err(|error| error.to_string())?;
    let _ = window.set_focus();
    Ok(())
}

#[tauri::command]
pub fn window_layout_load(app: AppHandle) -> Result<Option<WindowLayoutState>, String> {
    silk_window_state::window_layout_load(app)
}

#[tauri::command]
pub fn window_layout_file_exists(app: AppHandle) -> Result<bool, String> {
    silk_window_state::window_layout_file_exists(app)
}
