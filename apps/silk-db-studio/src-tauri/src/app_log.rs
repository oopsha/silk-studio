use crate::runtime_paths::RuntimePaths;
use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};

const LOG_DIR_NAME: &str = "logs";
const LOG_FILE_NAME: &str = "silk-db-studio.log";
const MAX_LOG_BYTES: u64 = 2 * 1024 * 1024; // 2 MiB
const MAX_ROTATED: usize = 2;

pub struct AppLogState {
    write_lock: Mutex<()>,
}

impl AppLogState {
    pub fn new() -> Self {
        Self {
            write_lock: Mutex::new(()),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppRuntimeInfo {
    pub app_name: String,
    pub app_version: String,
    pub tauri_version: String,
    pub os: String,
    pub arch: String,
    pub agent_jar_present: bool,
    pub agent_jar_path: String,
    pub agent_bundled: bool,
    pub java_bin_path: String,
    pub java_bundled: bool,
    pub log_dir: String,
    pub log_file: String,
}

/// Managed runtime paths for diagnostics / About.
pub struct ManagedRuntimePaths(pub RuntimePaths);

fn app_data_logs_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data dir: {error}"))?
        .join(LOG_DIR_NAME);
    fs::create_dir_all(&dir).map_err(|error| format!("Failed to create log dir: {error}"))?;
    Ok(dir)
}

fn log_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_logs_dir(app)?.join(LOG_FILE_NAME))
}

fn timestamp_utc() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Compact UTC-ish stamp without pulling chrono.
    let days = secs / 86_400;
    let time = secs % 86_400;
    let hours = time / 3600;
    let minutes = (time % 3600) / 60;
    let seconds = time % 60;
    // Civil date from days since 1970-01-01 (Howard Hinnant algorithm).
    let z = days as i64 + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };
    format!(
        "{year:04}-{m:02}-{d:02}T{hours:02}:{minutes:02}:{seconds:02}Z"
    )
}

/// Defense-in-depth redaction for anything written through the log command.
/// Frontend also redacts before invoke; never rely on a single layer.
pub fn redact_secrets(input: &str) -> String {
    let mut out = input.to_string();
    for key in [
        "password",
        "passwd",
        "pwd",
        "api_key",
        "apikey",
        "api-key",
        "authorization",
        "token",
        "secret",
    ] {
        out = redact_assigned_value(&out, key);
    }
    out = redact_prefix_token(&out, "bearer ");
    out = redact_prefix_token(&out, "sk-");
    out
}

fn redact_assigned_value(input: &str, key: &str) -> String {
    let lower = input.to_ascii_lowercase();
    let key_lower = key.to_ascii_lowercase();
    let mut result = String::with_capacity(input.len());
    let mut search_from = 0;

    while let Some(rel) = lower[search_from..].find(&key_lower) {
        let start = search_from + rel;
        let after_key = start + key_lower.len();
        let rest = &input[after_key..];
        let trimmed = rest.trim_start_matches([' ', '\t']);
        let trimmed_offset = rest.len() - trimmed.len();
        let sep_index = after_key + trimmed_offset;
        let Some(sep) = input[sep_index..].chars().next() else {
            result.push_str(&input[search_from..]);
            return result;
        };
        if sep != ':' && sep != '=' {
            result.push_str(&input[search_from..after_key]);
            search_from = after_key;
            continue;
        }

        result.push_str(&input[search_from..sep_index + sep.len_utf8()]);
        result.push_str("***");

        let value_start = sep_index + sep.len_utf8();
        let mut end = value_start;
        for (offset, ch) in input[value_start..].char_indices() {
            if matches!(ch, ' ' | '\t' | '\n' | '\r' | ',' | ';' | '&' | '"' | '\'') {
                end = value_start + offset;
                break;
            }
            end = value_start + offset + ch.len_utf8();
        }
        search_from = end;
    }

    result.push_str(&input[search_from..]);
    result
}

fn redact_prefix_token(input: &str, prefix: &str) -> String {
    let lower = input.to_ascii_lowercase();
    let prefix_lower = prefix.to_ascii_lowercase();
    let mut result = String::with_capacity(input.len());
    let mut search_from = 0;

    while let Some(rel) = lower[search_from..].find(&prefix_lower) {
        let start = search_from + rel;
        result.push_str(&input[search_from..start + prefix.len()]);
        result.push_str("***");
        let value_start = start + prefix.len();
        let mut end = value_start;
        for (offset, ch) in input[value_start..].char_indices() {
            if ch.is_whitespace() || ch == ',' || ch == ';' || ch == '&' {
                end = value_start + offset;
                break;
            }
            end = value_start + offset + ch.len_utf8();
        }
        search_from = end;
    }

    result.push_str(&input[search_from..]);
    result
}

fn rotated_path(path: &PathBuf, index: usize) -> PathBuf {
    PathBuf::from(format!("{}.{}", path.display(), index))
}

fn rotate_if_needed(path: &PathBuf) -> Result<(), String> {
    let meta = match fs::metadata(path) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("Failed to read log metadata: {error}")),
    };
    if meta.len() < MAX_LOG_BYTES {
        return Ok(());
    }

    // silk-db-studio.log.2 <- .1 <- current
    for index in (1..=MAX_ROTATED).rev() {
        let from = if index == 1 {
            path.clone()
        } else {
            rotated_path(path, index - 1)
        };
        let to = rotated_path(path, index);
        if from.exists() {
            let _ = fs::remove_file(&to);
            fs::rename(&from, &to).map_err(|error| format!("Failed to rotate log: {error}"))?;
        }
    }
    Ok(())
}

fn append_line(app: &AppHandle, state: &AppLogState, level: &str, message: &str) -> Result<(), String> {
    let _guard = state
        .write_lock
        .lock()
        .map_err(|_| "Failed to lock app log".to_string())?;

    let path = log_file_path(app)?;
    rotate_if_needed(&path)?;

    let safe = redact_secrets(message);
    let line = format!("[{}] [{}] {}\n", timestamp_utc(), level.to_ascii_uppercase(), safe);

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|error| format!("Failed to open log file: {error}"))?;
    file.write_all(line.as_bytes())
        .map_err(|error| format!("Failed to write log: {error}"))?;
    Ok(())
}

pub fn write_startup_banner(app: &AppHandle, state: &AppLogState, paths: &RuntimePaths) {
    let info = match build_runtime_info(app, paths) {
        Ok(info) => info,
        Err(error) => {
            let _ = append_line(
                app,
                state,
                "error",
                &format!("Failed to collect runtime info: {error}"),
            );
            return;
        }
    };
    let _ = append_line(
        app,
        state,
        "info",
        &format!(
            "Silk DB Studio {} starting (Tauri {}, OS {}/{}, agent bundled={}, java bundled={}, agent present={})",
            info.app_version,
            info.tauri_version,
            info.os,
            info.arch,
            info.agent_bundled,
            info.java_bundled,
            info.agent_jar_present
        ),
    );
    let _ = append_line(
        app,
        state,
        "info",
        &format!(
            "Runtime paths: java={} agent={}",
            info.java_bin_path, info.agent_jar_path
        ),
    );
}

pub fn append_startup_warning(
    app: &AppHandle,
    state: &AppLogState,
    message: &str,
) -> Result<(), String> {
    append_line(app, state, "warn", message)
}

fn build_runtime_info(app: &AppHandle, paths: &RuntimePaths) -> Result<AppRuntimeInfo, String> {
    let log_dir = app_data_logs_dir(app)?;
    let log_file = log_dir.join(LOG_FILE_NAME);
    Ok(AppRuntimeInfo {
        app_name: "Silk DB Studio".into(),
        app_version: env!("CARGO_PKG_VERSION").into(),
        tauri_version: tauri::VERSION.into(),
        os: std::env::consts::OS.into(),
        arch: std::env::consts::ARCH.into(),
        agent_jar_present: paths.agent_jar.exists(),
        agent_jar_path: paths.agent_jar.display().to_string(),
        agent_bundled: paths.agent_bundled,
        java_bin_path: paths.java_bin.display().to_string(),
        java_bundled: paths.java_bundled,
        log_dir: log_dir.display().to_string(),
        log_file: log_file.display().to_string(),
    })
}

#[tauri::command]
pub fn app_log_write(
    level: String,
    message: String,
    app: AppHandle,
    state: State<'_, AppLogState>,
) -> Result<(), String> {
    let normalized = match level.trim().to_ascii_lowercase().as_str() {
        "error" | "warn" | "info" | "debug" => level.trim().to_ascii_lowercase(),
        _ => "info".into(),
    };
    append_line(&app, &state, &normalized, &message)
}

#[tauri::command]
pub fn app_runtime_info(
    app: AppHandle,
    paths: State<'_, ManagedRuntimePaths>,
) -> Result<AppRuntimeInfo, String> {
    build_runtime_info(&app, &paths.0)
}

#[tauri::command]
pub fn app_log_open_folder(app: AppHandle) -> Result<(), String> {
    let dir = app_data_logs_dir(&app)?;
    open_path(&dir)
}

fn open_path(path: &PathBuf) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|error| format!("Failed to open log folder: {error}"))?;
        return Ok(());
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|error| format!("Failed to open log folder: {error}"))?;
        return Ok(());
    }
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        std::process::Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|error| format!("Failed to open log folder: {error}"))?;
        Ok(())
    }
}

