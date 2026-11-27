use std::{
    collections::HashMap,
    fs::{self, OpenOptions},
    io::{BufWriter, Write},
    path::PathBuf,
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{ipc::Channel, AppHandle, Manager, State};

const PROGRESS_CHANNEL_INTERVAL: Duration = Duration::from_millis(100);

#[derive(Default)]
pub struct CreateTasks(Mutex<HashMap<String, Arc<AtomicBool>>>);

/// The user's answer to a "file already exists" question, keyed by operation.
#[derive(Default)]
pub struct ConflictWaiters(Mutex<HashMap<String, std::sync::mpsc::Sender<(String, bool)>>>);

/// Called by the front end with `skip`, `overwrite`, `rename` or `cancel`; `apply_all` repeats
/// the answer for every further existing file of the same extraction.
#[tauri::command]
pub fn archive_resolve_conflict(waiters: State<'_, ConflictWaiters>, operation_id: String, action: String, apply_all: bool) -> bool {
    waiters
        .0
        .lock()
        .ok()
        .and_then(|map| map.get(&operation_id).cloned())
        .is_some_and(|sender| sender.send((action, apply_all)).is_ok())
}

#[derive(Clone, Copy, Default)]
struct ProgressSnapshot {
    sdk_callbacks: u64,
    channel_sent: u64,
    channel_failures: u64,
    completed_bytes: u64,
    total_bytes: u64,
    completed_entries: u32,
    total_entries: u32,
    last_callback_elapsed_ms: Option<u128>,
}

fn write_progress_log(app: &AppHandle, operation_id: &str, detail: &str) {
    write_progress_log_batch(app, operation_id, &[detail.to_string()]);
}

fn write_progress_log_batch(app: &AppHandle, operation_id: &str, details: &[String]) {
    static LOG_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    let Some(_guard) = LOG_LOCK.get_or_init(|| Mutex::new(())).lock().ok() else {
        return;
    };
    let Ok(log_dir) = app.path().app_log_dir() else {
        eprintln!("[silk-zip progress] app log directory is unavailable");
        return;
    };
    if let Err(error) = fs::create_dir_all(&log_dir) {
        eprintln!("[silk-zip progress] cannot create log directory: {error}");
        return;
    }
    let log_path = log_dir.join("archive-progress.log");
    let timestamp_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_millis());
    let Ok(file) = OpenOptions::new().create(true).append(true).open(&log_path) else {
        eprintln!("[silk-zip progress] cannot open {}", log_path.display());
        return;
    };
    let mut file = BufWriter::new(file);
    for detail in details {
        if let Err(error) = writeln!(file, "{timestamp_ms} operation={operation_id} {detail}") {
            eprintln!("[silk-zip progress] cannot write diagnostic log: {error}");
            return;
        }
    }
    if let Err(error) = file.flush() {
        eprintln!("[silk-zip progress] cannot flush diagnostic log: {error}");
    }
}

struct EntryProgressEvent {
    elapsed_ms: u128,
    completed_entries: usize,
    total_entries: usize,
    completed_bytes: u64,
    total_bytes: u64,
    callback_count: u64,
    callbacks_since_previous_entry: u64,
}

#[tauri::command]
pub async fn archive_list(path: String) -> Result<silk_archive::ArchiveListing, String> {
    tauri::async_runtime::spawn_blocking(move || {
        silk_archive::list_archive(std::path::Path::new(&path))
    })
    .await
    .map_err(|_| "압축 파일을 읽는 중 오류가 발생했습니다.".to_string())?
}

#[tauri::command]
pub async fn archive_extract(
    tasks: State<'_, CreateTasks>,
    waiters: State<'_, ConflictWaiters>,
    operation_id: String,
    archive_path: String,
    output_dir: String,
    password: Option<String>,
    overwrite: bool,
    ask_existing: bool,
    entries: Option<Vec<String>>,
    on_progress: Channel<silk_archive::CreateProgress>,
    on_conflict: Channel<silk_archive::ConflictQuery>,
) -> Result<silk_archive::ExtractResult, String> {
    if operation_id.is_empty() {
        return Err("압축 풀기 작업 식별자가 없습니다.".into());
    }
    let cancellation = Arc::new(AtomicBool::new(false));
    {
        let mut active = tasks
            .0
            .lock()
            .map_err(|_| "작업 상태를 읽지 못했습니다.")?;
        if active.contains_key(&operation_id) {
            return Err("이미 실행 중인 작업입니다.".into());
        }
        active.insert(operation_id.clone(), Arc::clone(&cancellation));
    }
    let worker_cancel = Arc::clone(&cancellation);
    let (reply_sender, reply_receiver) = std::sync::mpsc::channel::<(String, bool)>();
    if ask_existing {
        if let Ok(mut map) = waiters.0.lock() {
            map.insert(operation_id.clone(), reply_sender);
        }
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        use silk_archive::ConflictAnswer;
        let mut last_sent = Instant::now() - PROGRESS_CHANNEL_INTERVAL;
        let mut sticky: Option<ConflictAnswer> = None;
        let ask_cancel = Arc::clone(&worker_cancel);
        let mut handler = |query: &silk_archive::ConflictQuery| -> ConflictAnswer {
            if let Some(answer) = sticky {
                return answer;
            }
            if on_conflict.send(query.clone()).is_err() {
                return ConflictAnswer::Skip;
            }
            loop {
                if ask_cancel.load(Ordering::Relaxed) {
                    return ConflictAnswer::Cancel;
                }
                match reply_receiver.recv_timeout(Duration::from_millis(200)) {
                    Ok((action, apply_all)) => {
                        let answer = match action.as_str() {
                            "overwrite" => ConflictAnswer::Overwrite,
                            "rename" => ConflictAnswer::Rename,
                            "cancel" => ConflictAnswer::Cancel,
                            _ => ConflictAnswer::Skip,
                        };
                        if apply_all && answer != ConflictAnswer::Cancel {
                            sticky = Some(answer);
                        }
                        return answer;
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
                    Err(_) => return ConflictAnswer::Skip,
                }
            }
        };
        silk_archive::extract_entries_ask(
            std::path::Path::new(&archive_path),
            std::path::Path::new(&output_dir),
            password.as_deref(),
            overwrite,
            entries.as_deref().unwrap_or(&[]),
            &worker_cancel,
            |progress| {
                if last_sent.elapsed() >= PROGRESS_CHANNEL_INTERVAL || progress.phase != "writing" {
                    last_sent = Instant::now();
                    let _ = on_progress.send(progress);
                }
            },
            if ask_existing { Some(&mut handler) } else { None },
        )
    })
    .await
    .map_err(|_| "압축 풀기를 실행하지 못했습니다.".to_string());
    if let Ok(mut active) = tasks.0.lock() {
        active.remove(&operation_id);
    }
    if let Ok(mut map) = waiters.0.lock() {
        map.remove(&operation_id);
    }
    result?
}

#[tauri::command]
pub async fn archive_test(
    tasks: State<'_, CreateTasks>,
    operation_id: String,
    archive_path: String,
    password: Option<String>,
    on_progress: Channel<silk_archive::CreateProgress>,
) -> Result<silk_archive::TestResult, String> {
    if operation_id.is_empty() {
        return Err("테스트 작업 식별자가 없습니다.".into());
    }
    let cancellation = Arc::new(AtomicBool::new(false));
    {
        let mut active = tasks
            .0
            .lock()
            .map_err(|_| "작업 상태를 읽지 못했습니다.")?;
        if active.contains_key(&operation_id) {
            return Err("이미 실행 중인 작업입니다.".into());
        }
        active.insert(operation_id.clone(), Arc::clone(&cancellation));
    }
    let worker_cancel = Arc::clone(&cancellation);
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut last_sent = Instant::now() - PROGRESS_CHANNEL_INTERVAL;
        silk_archive::test_archive(
            std::path::Path::new(&archive_path),
            password.as_deref(),
            &worker_cancel,
            |progress| {
                if last_sent.elapsed() >= PROGRESS_CHANNEL_INTERVAL || progress.phase != "writing" {
                    last_sent = Instant::now();
                    let _ = on_progress.send(progress);
                }
            },
        )
    })
    .await
    .map_err(|_| "압축 파일 테스트를 실행하지 못했습니다.".to_string());
    if let Ok(mut active) = tasks.0.lock() {
        active.remove(&operation_id);
    }
    result?
}

#[tauri::command]
pub async fn archive_update(
    tasks: State<'_, CreateTasks>,
    operation_id: String,
    archive_path: String,
    changes: Vec<silk_archive::EntryChange>,
    adds: Vec<silk_archive::CreateInput>,
    password: Option<String>,
    on_progress: Channel<silk_archive::CreateProgress>,
) -> Result<silk_archive::UpdateResult, String> {
    if operation_id.is_empty() {
        return Err("변경 작업 식별자가 없습니다.".into());
    }
    let cancellation = Arc::new(AtomicBool::new(false));
    {
        let mut active = tasks
            .0
            .lock()
            .map_err(|_| "작업 상태를 읽지 못했습니다.")?;
        if active.contains_key(&operation_id) {
            return Err("이미 실행 중인 작업입니다.".into());
        }
        active.insert(operation_id.clone(), Arc::clone(&cancellation));
    }
    let worker_cancel = Arc::clone(&cancellation);
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut last_sent = Instant::now() - PROGRESS_CHANNEL_INTERVAL;
        silk_archive::update_archive(
            std::path::Path::new(&archive_path),
            &changes,
            &adds,
            password.as_deref(),
            &worker_cancel,
            |progress| {
                if last_sent.elapsed() >= PROGRESS_CHANNEL_INTERVAL || progress.phase != "writing" {
                    last_sent = Instant::now();
                    let _ = on_progress.send(progress);
                }
            },
        )
    })
    .await
    .map_err(|_| "변경을 실행하지 못했습니다.".to_string());
    if let Ok(mut active) = tasks.0.lock() {
        active.remove(&operation_id);
    }
    result?
}

#[tauri::command]
pub async fn archive_repair(
    tasks: State<'_, CreateTasks>,
    operation_id: String,
    archive_path: String,
    output_path: String,
    password: Option<String>,
    on_progress: Channel<silk_archive::CreateProgress>,
) -> Result<silk_archive::RepairResult, String> {
    if operation_id.is_empty() {
        return Err("복구 작업 식별자가 없습니다.".into());
    }
    let cancellation = Arc::new(AtomicBool::new(false));
    {
        let mut active = tasks
            .0
            .lock()
            .map_err(|_| "작업 상태를 읽지 못했습니다.")?;
        if active.contains_key(&operation_id) {
            return Err("이미 실행 중인 작업입니다.".into());
        }
        active.insert(operation_id.clone(), Arc::clone(&cancellation));
    }
    let worker_cancel = Arc::clone(&cancellation);
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut last_sent = Instant::now() - PROGRESS_CHANNEL_INTERVAL;
        silk_archive::repair_archive(
            std::path::Path::new(&archive_path),
            std::path::Path::new(&output_path),
            password.as_deref(),
            &worker_cancel,
            |progress| {
                if last_sent.elapsed() >= PROGRESS_CHANNEL_INTERVAL || progress.phase != "writing" {
                    last_sent = Instant::now();
                    let _ = on_progress.send(progress);
                }
            },
        )
    })
    .await
    .map_err(|_| "복구를 실행하지 못했습니다.".to_string());
    if let Ok(mut active) = tasks.0.lock() {
        active.remove(&operation_id);
    }
    result?
}

#[tauri::command]
pub async fn archive_create(
    app: AppHandle,
    tasks: State<'_, CreateTasks>,
    operation_id: String,
    inputs: Vec<silk_archive::CreateInput>,
    input_entry_sizes: Vec<u64>,
    output_path: String,
    format: silk_archive::ArchiveFormat,
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
    let operation_started = Instant::now();
    let progress_snapshot = Arc::new(Mutex::new(ProgressSnapshot::default()));
    let sampling = Arc::new(AtomicBool::new(true));
    let sampler_snapshot = Arc::clone(&progress_snapshot);
    let sampler_running = Arc::clone(&sampling);
    let sampler_app = app.clone();
    let sampler_operation_id = operation_id.clone();
    let sampler = thread::spawn(move || {
        let mut previous_callbacks = 0;
        let mut previous_sample_elapsed_ms = 0;
        while sampler_running.load(Ordering::Relaxed) {
            thread::sleep(Duration::from_secs(1));
            if !sampler_running.load(Ordering::Relaxed) {
                break;
            }
            let elapsed_ms = operation_started.elapsed().as_millis();
            let snapshot = sampler_snapshot
                .lock()
                .map(|value| *value)
                .unwrap_or_default();
            let callback_age_ms = snapshot.last_callback_elapsed_ms.map_or_else(
                || "none".into(),
                |last| elapsed_ms.saturating_sub(last).to_string(),
            );
            let callbacks_delta = snapshot.sdk_callbacks.saturating_sub(previous_callbacks);
            let sample_interval_ms = elapsed_ms.saturating_sub(previous_sample_elapsed_ms);
            previous_callbacks = snapshot.sdk_callbacks;
            previous_sample_elapsed_ms = elapsed_ms;
            write_progress_log(
                &sampler_app,
                &sampler_operation_id,
                &format!(
                    "layer=backend elapsed_ms={elapsed_ms} sample_interval_ms={sample_interval_ms} sdk_callbacks={} callbacks_since_last_sample={callbacks_delta} channel_sent={} channel_failures={} completed_bytes={} total_bytes={} completed_entries={} total_entries={} callback_age_ms={callback_age_ms}",
                    snapshot.sdk_callbacks,
                    snapshot.channel_sent,
                    snapshot.channel_failures,
                    snapshot.completed_bytes,
                    snapshot.total_bytes,
                    snapshot.completed_entries,
                    snapshot.total_entries,
                ),
            );
        }
    });
    write_progress_log(
        &app,
        &operation_id,
        &format!(
            "event=started total_entries={} split={}",
            inputs.len(),
            split_size_bytes.is_some()
        ),
    );
    let mut largest_entries = input_entry_sizes
        .iter()
        .copied()
        .enumerate()
        .filter(|(_, size)| *size > 0)
        .collect::<Vec<_>>();
    largest_entries.sort_unstable_by(|left, right| right.1.cmp(&left.1));
    let total_input_bytes = input_entry_sizes
        .iter()
        .fold(0_u64, |total, size| total.saturating_add(*size));
    let entry_checkpoints = [25, 50, 75, 90]
        .into_iter()
        .map(|percent| {
            let entry_count = input_entry_sizes.len() * percent / 100;
            let bytes = input_entry_sizes
                .iter()
                .take(entry_count)
                .fold(0_u64, |total, size| total.saturating_add(*size));
            format!("{percent}%:{bytes}")
        })
        .collect::<Vec<_>>()
        .join(",");
    let largest_entries = largest_entries
        .into_iter()
        .take(10)
        .map(|(index, size)| format!("{}:{size}", index + 1))
        .collect::<Vec<_>>()
        .join(",");
    write_progress_log(
        &app,
        &operation_id,
        &format!(
            "event=input_size_summary entries={} file_entries={} total_file_bytes={total_input_bytes} entry_prefix_bytes={entry_checkpoints} largest_entry_index_bytes={largest_entries}",
            input_entry_sizes.len(),
            input_entry_sizes.iter().filter(|size| **size > 0).count(),
        ),
    );
    let progress_app = app.clone();
    let progress_operation_id = operation_id.clone();
    let worker_snapshot = Arc::clone(&progress_snapshot);
    let pending_progress = Arc::new(Mutex::new(None::<silk_archive::CreateProgress>));
    let worker_pending_progress = Arc::clone(&pending_progress);
    let flush_channel = on_progress.clone();
    let worker_result = tauri::async_runtime::spawn_blocking(move || {
        let mut last_channel_send = Instant::now()
            .checked_sub(PROGRESS_CHANNEL_INTERVAL)
            .unwrap_or_else(Instant::now);
        let mut callback_count = 0_u64;
        let mut last_entry_callback_count = 0_u64;
        let mut last_logged_completed_entries = 0_usize;
        let mut entry_progress_events = Vec::new();
        let mut diagnostics = silk_archive::ZipDiagnostics::default();
        let result = silk_archive::create_archive_entries(
            format,
            &inputs,
            &output,
            compression_level,
            password.as_deref(),
            split_size_bytes,
            &worker_cancel,
            |progress| {
                callback_count += 1;
                if let Ok(mut snapshot) = worker_snapshot.lock() {
                    snapshot.sdk_callbacks = callback_count;
                    snapshot.completed_bytes = progress.completed_bytes;
                    snapshot.total_bytes = progress.total_bytes;
                    snapshot.completed_entries = progress.completed_entries as u32;
                    snapshot.total_entries = progress.total_entries as u32;
                    snapshot.last_callback_elapsed_ms =
                        Some(operation_started.elapsed().as_millis());
                }
                if progress.completed_entries != last_logged_completed_entries {
                    entry_progress_events.push(EntryProgressEvent {
                        elapsed_ms: operation_started.elapsed().as_millis(),
                        completed_entries: progress.completed_entries,
                        total_entries: progress.total_entries,
                        completed_bytes: progress.completed_bytes,
                        total_bytes: progress.total_bytes,
                        callback_count,
                        callbacks_since_previous_entry:
                            callback_count.saturating_sub(last_entry_callback_count),
                    });
                    last_logged_completed_entries = progress.completed_entries;
                    last_entry_callback_count = callback_count;
                }
                let should_send = progress.phase == "finalizing"
                    || last_channel_send.elapsed() >= PROGRESS_CHANNEL_INTERVAL;
                if should_send {
                    if let Ok(mut pending) = worker_pending_progress.lock() {
                        pending.take();
                    }
                    let sent = on_progress.send(progress).is_ok();
                    last_channel_send = Instant::now();
                    if let Ok(mut snapshot) = worker_snapshot.lock() {
                        if sent {
                            snapshot.channel_sent += 1;
                        } else {
                            snapshot.channel_failures += 1;
                        }
                    }
                } else if let Ok(mut pending) = worker_pending_progress.lock() {
                    *pending = Some(progress);
                }
            },
            Some(&mut diagnostics),
        );
        (result, entry_progress_events, diagnostics)
    })
    .await;
    let (result, entry_progress_events, diagnostics) =
        worker_result.map_err(|_| "압축 작업을 실행하지 못했습니다.".to_string())?;
    let mut entry_progress_logs = entry_progress_events
        .into_iter()
        .map(|event| {
            format!(
                "event=entry_progress elapsed_ms={} completed_entries={} total_entries={} completed_bytes={} total_bytes={} callback_count={} callbacks_since_previous_entry={}",
                event.elapsed_ms,
                event.completed_entries,
                event.total_entries,
                event.completed_bytes,
                event.total_bytes,
                event.callback_count,
                event.callbacks_since_previous_entry,
            )
        })
        .collect::<Vec<_>>();
    if let Some(sdk_started_at) = diagnostics.sdk_started_at {
        entry_progress_logs.push(format!(
            "event=sdk_file_summary sdk_call_start_us={} files={} folders={} empty_files={} streams_opened={}",
            sdk_started_at.duration_since(operation_started).as_micros(),
            diagnostics.files,
            diagnostics.folders,
            diagnostics.empty_files,
            diagnostics.timings.len(),
        ));
        entry_progress_logs.extend(diagnostics.timings.into_iter().map(|timing| {
            let released = timing.released_us.map_or_else(|| "none".into(), |us| us.to_string());
            format!(
                "event=sdk_file_stream index={} size_bytes={} opened_sdk_us={} released_sdk_us={released}",
                timing.index, timing.size, timing.opened_us,
            )
        }));
    }
    write_progress_log_batch(&progress_app, &progress_operation_id, &entry_progress_logs);
    if let Ok(mut pending) = pending_progress.lock() {
        if let Some(progress) = pending.take() {
            let sent = flush_channel.send(progress).is_ok();
            if let Ok(mut snapshot) = progress_snapshot.lock() {
                if sent {
                    snapshot.channel_sent += 1;
                } else {
                    snapshot.channel_failures += 1;
                }
            }
        }
    }
    sampling.store(false, Ordering::Relaxed);
    let _ = sampler.join();
    write_progress_log(
        &progress_app,
        &progress_operation_id,
        &format!(
            "event=finished elapsed_ms={} result={}",
            operation_started.elapsed().as_millis(),
            if result.is_ok() {
                "success"
            } else {
                "failure"
            }
        ),
    );
    if let Ok(mut active) = tasks.0.lock() {
        active.remove(&operation_id);
    }
    result
}

#[tauri::command]
pub fn archive_progress_diagnostic(
    app: AppHandle,
    operation_id: String,
    received_count: u64,
    received_since_last_sample: u64,
    sample_interval_ms: u64,
    completed_bytes: u64,
    total_bytes: u64,
    completed_entries: u32,
    total_entries: u32,
    last_message_age_ms: u64,
) {
    write_progress_log(
        &app,
        &operation_id,
        &format!(
            "layer=frontend received={} received_since_last_sample={} sample_interval_ms={} completed_bytes={} total_bytes={} completed_entries={} total_entries={} message_age_ms={}",
            received_count,
            received_since_last_sample,
            sample_interval_ms,
            completed_bytes,
            total_bytes,
            completed_entries,
            total_entries,
            last_message_age_ms
        ),
    );
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

/// Opens the folder containing `path` with the file selected where the OS supports it.
#[tauri::command]
pub fn reveal_in_folder(path: String) -> Result<(), String> {
    let file = PathBuf::from(&path);
    if !file.exists() {
        return Err("압축 파일을 찾을 수 없습니다.".into());
    }
    #[cfg(target_os = "windows")]
    let mut command = {
        use std::os::windows::process::CommandExt;
        let mut command = Command::new("explorer.exe");
        command.raw_arg(format!("/select,\"{}\"", file.display()));
        command
    };
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg("-R").arg(&file);
        command
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(file.parent().unwrap_or(std::path::Path::new(".")));
        command
    };
    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("폴더를 열지 못했습니다: {error}"))
}

/// Saves a copy of an archive under another name. The copy is written next to the target
/// first and renamed into place, so a failed copy never leaves a partial archive.
#[tauri::command]
pub async fn archive_save_as(source: String, target: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let source = PathBuf::from(source);
        let target = PathBuf::from(target);
        if !source.is_file() {
            return Err("압축 파일을 찾을 수 없습니다.".to_string());
        }
        if source.to_string_lossy().to_lowercase().ends_with(".001") {
            return Err("분할 압축 파일은 다른 이름으로 저장할 수 없습니다.".into());
        }
        if let (Ok(a), Ok(b)) = (std::fs::canonicalize(&source), std::fs::canonicalize(&target)) {
            if a == b {
                return Err("원본과 같은 위치에는 저장할 수 없습니다.".into());
            }
        }
        let name = target
            .file_name()
            .ok_or("저장할 파일 이름이 올바르지 않습니다.")?
            .to_string_lossy()
            .into_owned();
        let temporary = target.with_file_name(format!(".{name}.silk-save"));
        let result = std::fs::copy(&source, &temporary).and_then(|_| std::fs::rename(&temporary, &target));
        if let Err(error) = result {
            let _ = std::fs::remove_file(&temporary);
            return Err(format!("저장하지 못했습니다: {error}"));
        }
        Ok(())
    })
    .await
    .map_err(|_| "저장을 실행하지 못했습니다.".to_string())?
}

/// Quits the whole app (all windows).
#[tauri::command]
pub fn exit_app(app: AppHandle) {
    // Closing the web views first lets WebView2 tear down its windows before the process ends.
    for window in app.webview_windows().into_values() {
        let _ = window.destroy();
    }
    app.exit(0);
}

/// Command line flag of a second window; it is shifted so it does not hide the first one.
pub const NEW_WINDOW_ARG: &str = "--new-window";

/// Starts another instance of the app. With `admin` (Windows only) it is started elevated,
/// which shows the system permission prompt.
#[tauri::command]
pub fn new_window(admin: bool) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|error| format!("실행 파일 경로를 찾지 못했습니다: {error}"))?;
    if admin {
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            // Elevating a packaged app needs a capability the Store package does not ask for.
            if crate::store::is_packaged() {
                return Err("Store 버전에서는 관리자 권한 새 창을 지원하지 않습니다.".into());
            }
            let path = exe.display().to_string().replace('\'', "''");
            return Command::new("powershell.exe")
                .args(["-NoProfile", "-WindowStyle", "Hidden", "-Command"])
                .arg(format!("Start-Process -FilePath '{path}' -ArgumentList '{NEW_WINDOW_ARG}' -Verb RunAs"))
                .creation_flags(0x0800_0000)
                .spawn()
                .map(|_| ())
                .map_err(|error| format!("관리자 권한으로 새 창을 열지 못했습니다: {error}"));
        }
        #[cfg(not(target_os = "windows"))]
        return Err("관리자 권한 새 창은 Windows에서만 지원합니다.".into());
    }
    Command::new(exe)
        .arg(NEW_WINDOW_ARG)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("새 창을 열지 못했습니다: {error}"))
}

/// Whether the process runs with administrator rights (always false off Windows).
/// Windows blocks drag and drop from a non-elevated Explorer onto such a window.
#[tauri::command]
pub fn is_elevated() -> bool {
    #[cfg(target_os = "windows")]
    unsafe {
        use windows_sys::Win32::{
            Foundation::{CloseHandle, HANDLE},
            Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY},
            System::Threading::{GetCurrentProcess, OpenProcessToken},
        };
        let mut token: HANDLE = std::ptr::null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return false;
        }
        let mut elevation = TOKEN_ELEVATION { TokenIsElevated: 0 };
        let mut size = 0u32;
        let ok = GetTokenInformation(
            token,
            TokenElevation,
            (&mut elevation as *mut TOKEN_ELEVATION).cast(),
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut size,
        );
        CloseHandle(token);
        ok != 0 && elevation.TokenIsElevated != 0
    }
    #[cfg(not(target_os = "windows"))]
    false
}

/// Opens the folder the program is installed in (on macOS, the one holding the `.app` bundle).
#[tauri::command]
pub fn open_install_folder() -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|error| format!("설치 위치를 확인하지 못했습니다: {error}"))?;
    let target = exe
        .ancestors()
        .find(|path| path.extension().is_some_and(|ext| ext == "app"))
        .unwrap_or(exe.as_path());
    open_output_folder(target.to_string_lossy().into_owned())
}

/// Opens a page of the product website in the default browser; no other address is accepted.
#[tauri::command]
pub fn open_website(url: String) -> Result<(), String> {
    if !url.starts_with("https://silkstudio.co.kr/") {
        return Err("열 수 없는 주소입니다.".into());
    }
    #[cfg(target_os = "windows")]
    let opener = "explorer.exe";
    #[cfg(target_os = "macos")]
    let opener = "open";
    #[cfg(all(unix, not(target_os = "macos")))]
    let opener = "xdg-open";
    Command::new(opener).arg(url).spawn().map(|_| ()).map_err(|error| format!("브라우저를 열지 못했습니다: {error}"))
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
