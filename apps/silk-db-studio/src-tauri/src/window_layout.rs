use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, Position, Size, WebviewWindow};

const FILE_NAME: &str = "window-layout.json";
const MIN_WIDTH: f64 = 640.0;
const MIN_HEIGHT: f64 = 480.0;
/// Logical offset from the top-left used as a "title bar" probe for visibility.
const VISIBLE_PROBE_X: f64 = 40.0;
const VISIBLE_PROBE_Y: f64 = 20.0;
const FALLBACK_MARGIN: f64 = 50.0;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowLayoutState {
    #[serde(rename = "windowX")]
    pub window_x: f64,
    #[serde(rename = "windowY")]
    pub window_y: f64,
    #[serde(rename = "windowWidth")]
    pub window_width: f64,
    #[serde(rename = "windowHeight")]
    pub window_height: f64,
    #[serde(rename = "windowMaximized")]
    pub window_maximized: bool,
}

fn layout_file_path(app: &AppHandle) -> tauri::Result<PathBuf> {
    Ok(app.path().app_data_dir()?.join(FILE_NAME))
}

fn normalize_layout(layout: &WindowLayoutState) -> WindowLayoutState {
    WindowLayoutState {
        window_x: layout.window_x.round(),
        window_y: layout.window_y.round(),
        window_width: layout.window_width.round().max(MIN_WIDTH),
        window_height: layout.window_height.round().max(MIN_HEIGHT),
        window_maximized: layout.window_maximized,
    }
}

fn point_on_monitor(
    monitor: &tauri::Monitor,
    physical_x: i32,
    physical_y: i32,
) -> bool {
    let pos = monitor.position();
    let size = monitor.size();
    physical_x >= pos.x
        && physical_y >= pos.y
        && physical_x < pos.x + size.width as i32
        && physical_y < pos.y + size.height as i32
}

/// Ensure a title-bar probe point lands on some connected monitor.
/// If not (disconnected display, bad coords), move to the primary monitor.
fn clamp_to_visible(window: &WebviewWindow, layout: WindowLayoutState) -> WindowLayoutState {
    let mut layout = normalize_layout(&layout);

    let monitors = match window.available_monitors() {
        Ok(m) if !m.is_empty() => m,
        _ => return layout,
    };

    let scale = window.scale_factor().unwrap_or(1.0);
    let probe_x = ((layout.window_x + VISIBLE_PROBE_X) * scale).round() as i32;
    let probe_y = ((layout.window_y + VISIBLE_PROBE_Y) * scale).round() as i32;

    if monitors
        .iter()
        .any(|m| point_on_monitor(m, probe_x, probe_y))
    {
        return layout;
    }

    let target = window
        .primary_monitor()
        .ok()
        .flatten()
        .unwrap_or_else(|| monitors[0].clone());
    let pos = target.position();
    let size = target.size();
    let target_scale = target.scale_factor();

    layout.window_x = (pos.x as f64 / target_scale).round() + FALLBACK_MARGIN;
    layout.window_y = (pos.y as f64 / target_scale).round() + FALLBACK_MARGIN;

    let max_w = ((size.width as f64 / target_scale) - FALLBACK_MARGIN * 2.0).max(MIN_WIDTH);
    let max_h = ((size.height as f64 / target_scale) - FALLBACK_MARGIN * 2.0).max(MIN_HEIGHT);
    layout.window_width = layout.window_width.min(max_w);
    layout.window_height = layout.window_height.min(max_h);

    layout
}

pub fn load_window_layout(app: &AppHandle) -> Option<WindowLayoutState> {
    let path = layout_file_path(app).ok()?;
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str::<WindowLayoutState>(&raw)
        .ok()
        .map(|layout| normalize_layout(&layout))
}

pub fn save_window_layout(app: &AppHandle, layout: &WindowLayoutState) -> tauri::Result<()> {
    let path = layout_file_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let normalized = normalize_layout(layout);
    fs::write(path, serde_json::to_string(&normalized)?)?;
    Ok(())
}

pub fn apply_window_layout(
    window: &WebviewWindow,
    layout: &WindowLayoutState,
) -> tauri::Result<()> {
    let layout = clamp_to_visible(window, layout.clone());

    if layout.window_maximized {
        window.set_size(Size::Logical(LogicalSize::new(
            layout.window_width,
            layout.window_height,
        )))?;
        window.set_position(Position::Logical(LogicalPosition::new(
            layout.window_x,
            layout.window_y,
        )))?;
        window.maximize()?;
        return Ok(());
    }

    if window.is_maximized().unwrap_or(false) {
        let _ = window.unmaximize();
    }
    window.set_size(Size::Logical(LogicalSize::new(
        layout.window_width,
        layout.window_height,
    )))?;
    window.set_position(Position::Logical(LogicalPosition::new(
        layout.window_x,
        layout.window_y,
    )))?;
    Ok(())
}

/// Restore saved geometry (if any) then always show the window.
/// Call this from app setup so `visible: false` never leaves the window hidden.
pub fn restore_main_window(app: &AppHandle, window: &WebviewWindow) {
    if let Some(layout) = load_window_layout(app) {
        if apply_window_layout(window, &layout).is_err() {
            // Corrupt geometry or OS rejection — still show at default position.
        }
    }
    let _ = window.show();
    let _ = window.set_focus();
}

#[tauri::command]
pub fn window_layout_save(app: AppHandle, layout: WindowLayoutState) -> Result<(), String> {
    let layout = if let Some(window) = app.get_webview_window("main") {
        clamp_to_visible(&window, layout)
    } else {
        normalize_layout(&layout)
    };
    save_window_layout(&app, &layout).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn window_layout_apply_and_show(
    app: AppHandle,
    window: WebviewWindow,
    layout: WindowLayoutState,
) -> Result<(), String> {
    let clamped = clamp_to_visible(&window, layout);
    let _ = apply_window_layout(&window, &clamped);
    let _ = save_window_layout(&app, &clamped);
    window.show().map_err(|e| e.to_string())?;
    let _ = window.set_focus();
    Ok(())
}

#[tauri::command]
pub fn window_layout_show(window: WebviewWindow) -> Result<(), String> {
    window.show().map_err(|e| e.to_string())?;
    let _ = window.set_focus();
    Ok(())
}

#[tauri::command]
pub fn window_layout_file_exists(app: AppHandle) -> Result<bool, String> {
    let path = layout_file_path(&app).map_err(|e| e.to_string())?;
    Ok(path.is_file())
}
