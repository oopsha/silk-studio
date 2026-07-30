use keyring::{Entry, Error as KeyringError};

const CONNECTION_SERVICE_NAME: &str = "silk-db-studio.connection";
const AI_SERVICE_NAME: &str = "silk-db-studio.ai";

const AI_PROVIDERS: &[&str] = &["gemini", "openai", "anthropic", "custom"];

fn entry_for_profile(profile_id: &str) -> Result<Entry, String> {
    let account = format!("profile:{profile_id}");
    Entry::new(CONNECTION_SERVICE_NAME, &account).map_err(map_keyring_error)
}

fn entry_for_ai_provider(provider: &str) -> Result<Entry, String> {
    let account = format!("provider:{provider}");
    Entry::new(AI_SERVICE_NAME, &account).map_err(map_keyring_error)
}

fn map_keyring_error(error: KeyringError) -> String {
    match error {
        KeyringError::NoEntry => "Secret not found.".into(),
        other => format!("OS credential store error: {other}"),
    }
}

fn normalize_ai_provider(provider: &str) -> Result<String, String> {
    let id = provider.trim().to_ascii_lowercase();
    if AI_PROVIDERS.contains(&id.as_str()) {
        Ok(id)
    } else {
        Err(format!("Unsupported AI provider: {provider}"))
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

#[tauri::command]
pub fn ai_secret_set(provider: String, api_key: String) -> Result<(), String> {
    let id = normalize_ai_provider(&provider)?;
    let key = api_key.trim();
    if key.is_empty() {
        return Err("api_key is required.".into());
    }
    if key.len() > 2048 {
        return Err("api_key is too long.".into());
    }
    let entry = entry_for_ai_provider(&id)?;
    entry.set_password(key).map_err(map_keyring_error)
}

#[tauri::command]
pub fn ai_secret_get(provider: String) -> Result<String, String> {
    let id = normalize_ai_provider(&provider)?;
    let entry = entry_for_ai_provider(&id)?;
    match entry.get_password() {
        Ok(password) => Ok(password),
        Err(KeyringError::NoEntry) => Ok(String::new()),
        Err(error) => Err(map_keyring_error(error)),
    }
}

#[tauri::command]
pub fn ai_secret_delete(provider: String) -> Result<(), String> {
    let id = normalize_ai_provider(&provider)?;
    let entry = entry_for_ai_provider(&id)?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(KeyringError::NoEntry) => Ok(()),
        Err(error) => Err(map_keyring_error(error)),
    }
}
