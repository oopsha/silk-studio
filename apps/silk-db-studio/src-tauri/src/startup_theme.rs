use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const FILE_NAME: &str = "startup-theme.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupTheme {
    pub background_color: String,
    pub foreground_color: String,
    pub hover_background: String,
    pub pressed_background: String,
}

impl Default for StartupTheme {
    fn default() -> Self {
        Self {
            background_color: "#191a1b".into(),
            foreground_color: "#8c8c8c".into(),
            hover_background: "#323233".into(),
            pressed_background: "#3c3c3d".into(),
        }
    }
}

fn file_path(app: &AppHandle) -> tauri::Result<PathBuf> {
    Ok(app.path().app_data_dir()?.join(FILE_NAME))
}

fn is_hex_color(value: &str) -> bool {
    value.len() == 7
        && value.starts_with('#')
        && value.as_bytes()[1..].iter().all(|byte| byte.is_ascii_hexdigit())
}

fn is_valid(theme: &StartupTheme) -> bool {
    is_hex_color(&theme.background_color)
        && is_hex_color(&theme.foreground_color)
        && is_hex_color(&theme.hover_background)
        && is_hex_color(&theme.pressed_background)
}

pub fn load(app: &AppHandle) -> StartupTheme {
    let Some(theme) = file_path(app)
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|raw| serde_json::from_str::<StartupTheme>(&raw).ok())
    else {
        return StartupTheme::default();
    };

    if is_valid(&theme) {
        theme
    } else {
        StartupTheme::default()
    }
}

pub fn save(app: &AppHandle, theme: &StartupTheme) -> tauri::Result<()> {
    if !is_valid(theme) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Invalid startup theme colors.",
        )
        .into());
    }
    let path = file_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, serde_json::to_string(theme)?)?;
    Ok(())
}

#[tauri::command]
pub fn startup_theme_save(app: AppHandle, theme: StartupTheme) -> Result<(), String> {
    save(&app, &theme).map_err(|error| error.to_string())
}
