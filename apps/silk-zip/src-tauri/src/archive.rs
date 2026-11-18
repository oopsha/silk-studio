use std::{
    collections::HashMap,
    path::PathBuf,
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tauri::{ipc::Channel, State};

#[derive(Default)]
pub struct CreateTasks(Mutex<HashMap<String, Arc<AtomicBool>>>);

#[tauri::command]
pub async fn archive_list(path: String) -> Result<silk_archive::ArchiveListing, String> {
    tauri::async_runtime::spawn_blocking(move || {
        silk_archive::list_archive(std::path::Path::new(&path))
    })
    .await
    .map_err(|_| "압축 파일을 읽는 중 오류가 발생했습니다.".to_string())?
}

#[tauri::command]
pub async fn archive_create(
    tasks: State<'_, CreateTasks>,
    operation_id: String,
    inputs: Vec<silk_archive::CreateInput>,
    output_path: String,
    compression_level: u8,
    password: Option<String>,
    split_size_bytes: Option<u64>,
    on_progress: Channel<silk_archive::CreateProgress>,
) -> Result<silk_archive::CreateResult, String> {
    if operation_id.is_empty() {
        return Err("압축 작업 식별자가 없습니다.".into());
    }
    let cancellation = Arc::new(AtomicBool::new(false));
    {
        let mut active = tasks
            .0
            .lock()
            .map_err(|_| "압축 작업 상태를 읽지 못했습니다.")?;
        if active.contains_key(&operation_id) {
            return Err("이미 실행 중인 압축 작업입니다.".into());
        }
        active.insert(operation_id.clone(), Arc::clone(&cancellation));
    }

    let output = PathBuf::from(output_path);
    let worker_cancel = Arc::clone(&cancellation);
    let result = tauri::async_runtime::spawn_blocking(move || {
        silk_archive::create_zip_entries_with_split(
            &inputs,
            &output,
            compression_level,
            password.as_deref(),
            split_size_bytes,
            &worker_cancel,
            |progress| {
                let _ = on_progress.send(progress);
            },
        )
    })
    .await;
    if let Ok(mut active) = tasks.0.lock() {
        active.remove(&operation_id);
    }
    result.map_err(|_| "압축 작업을 실행하지 못했습니다.".to_string())?
}

#[tauri::command]
pub fn archive_cancel(tasks: State<'_, CreateTasks>, operation_id: String) -> bool {
    let Ok(active) = tasks.0.lock() else {
        return false;
    };
    if let Some(cancellation) = active.get(&operation_id) {
        cancellation.store(true, Ordering::Relaxed);
        true
    } else {
        false
    }
}

#[tauri::command]
pub fn open_output_folder(path: String) -> Result<(), String> {
    let output = PathBuf::from(path);
    let folder = output
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or(std::path::Path::new("."));
    if !folder.is_dir() {
        return Err("압축 파일이 저장된 폴더를 찾을 수 없습니다.".into());
    }
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("explorer.exe");
        command.arg(folder);
        command
    };
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(folder);
        command
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(folder);
        command
    };
    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("폴더를 열지 못했습니다: {error}"))
}
