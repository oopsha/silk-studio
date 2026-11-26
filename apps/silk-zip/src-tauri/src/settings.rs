use tauri::AppHandle;

/// The saved text of a named value (settings, workbench configuration, ...), or `None`.
#[tauri::command]
pub fn settings_load(app: AppHandle, name: String) -> Result<Option<String>, String> {
    silk_window_state::stored_value_load(app, name)
}

/// The folder dialog's "named folder" choice from the saved Zip settings (on by default), read
/// before the app is up. Same file as `stored_value_load(app, "settings")`.
#[cfg(windows)]
pub fn extract_named_folder() -> bool {
    let Some(data) = std::env::var_os("APPDATA") else { return true };
    let path = std::path::Path::new(&data).join("com.oopsha.silk-zip").join("settings.json");
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|value| value.get("extractNamedFolder")?.as_bool())
        .unwrap_or(true)
}

#[tauri::command]
pub fn settings_save(app: AppHandle, name: String, text: String) -> Result<(), String> {
    silk_window_state::stored_value_save(app, name, text)
}
