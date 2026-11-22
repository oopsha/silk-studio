use tauri::AppHandle;

/// The saved text of a named value (settings, workbench configuration, ...), or `None`.
#[tauri::command]
pub fn settings_load(app: AppHandle, name: String) -> Result<Option<String>, String> {
    silk_window_state::stored_value_load(app, name)
}

#[tauri::command]
pub fn settings_save(app: AppHandle, name: String, text: String) -> Result<(), String> {
    silk_window_state::stored_value_save(app, name, text)
}
