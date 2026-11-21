//! Silk Zip user settings, kept as one JSON file in the app data folder.
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// Each saved value has its own `<name>.json` (`settings`, `recent-archives`, ...).
fn settings_path(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    if name.is_empty() || !name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-') {
        return Err("올바르지 않은 설정 이름입니다.".into());
    }
    app.path()
        .app_data_dir()
        .map(|dir| dir.join(format!("{name}.json")))
        .map_err(|error| error.to_string())
}

/// The saved settings text, or `None` when nothing was saved yet.
#[tauri::command]
pub fn settings_load(app: AppHandle, name: String) -> Result<Option<String>, String> {
    let path = settings_path(&app, &name)?;
    match fs::read_to_string(&path) {
        Ok(text) => Ok(Some(text)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("설정을 읽지 못했습니다: {error}")),
    }
}

/// Saves the settings text; written next to the target first so a failure never leaves a partial file.
#[tauri::command]
pub fn settings_save(app: AppHandle, name: String, text: String) -> Result<(), String> {
    let path = settings_path(&app, &name)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("설정을 저장하지 못했습니다: {error}"))?;
    }
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, text)
        .and_then(|_| fs::rename(&temporary, &path))
        .map_err(|error| {
            let _ = fs::remove_file(&temporary);
            format!("설정을 저장하지 못했습니다: {error}")
        })
}
