use keyring::{Entry, Error as KeyringError};

const SERVICE_NAME: &str = "silk-db-studio.connection";

fn entry_for_profile(profile_id: &str) -> Result<Entry, String> {
    let account = format!("profile:{profile_id}");
    Entry::new(SERVICE_NAME, &account).map_err(map_keyring_error)
}

fn map_keyring_error(error: KeyringError) -> String {
    match error {
        KeyringError::NoEntry => "Secret not found.".into(),
        other => format!("OS credential store error: {other}"),
    }
}

#[tauri::command]
pub fn secret_set(profile_id: String, password: String) -> Result<(), String> {
    let id = profile_id.trim();
    if id.is_empty() {
        return Err("profile_id is required.".into());
    }
    let entry = entry_for_profile(id)?;
    entry
        .set_password(password.as_str())
        .map_err(map_keyring_error)
}

#[tauri::command]
pub fn secret_get(profile_id: String) -> Result<String, String> {
    let id = profile_id.trim();
    if id.is_empty() {
        return Err("profile_id is required.".into());
    }
    let entry = entry_for_profile(id)?;
    match entry.get_password() {
        Ok(password) => Ok(password),
        Err(KeyringError::NoEntry) => Ok(String::new()),
        Err(error) => Err(map_keyring_error(error)),
    }
}

#[tauri::command]
pub fn secret_delete(profile_id: String) -> Result<(), String> {
    let id = profile_id.trim();
    if id.is_empty() {
        return Err("profile_id is required.".into());
    }
    let entry = entry_for_profile(id)?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(KeyringError::NoEntry) => Ok(()),
        Err(error) => Err(map_keyring_error(error)),
    }
}
