//! Shared ZIP creation support backed by libarchive.
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    ffi::{c_char, c_int, c_void, CStr, CString},
    fs::{self, File, Metadata},
    io::Read,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
    time::UNIX_EPOCH,
};

#[cfg(any(windows, target_os = "macos"))]
type ArchiveMode = u16;
#[cfg(not(any(windows, target_os = "macos")))]
type ArchiveMode = u32;

unsafe extern "C" {
    fn archive_write_new() -> *mut c_void;
    fn archive_write_set_format_zip(a: *mut c_void) -> c_int;
    fn archive_write_add_filter_none(a: *mut c_void) -> c_int;
    fn archive_write_set_options(a: *mut c_void, options: *const c_char) -> c_int;
    fn archive_write_set_passphrase(a: *mut c_void, passphrase: *const c_char) -> c_int;
    #[cfg(not(windows))]
    fn archive_write_open_filename(a: *mut c_void, path: *const c_char) -> c_int;
    #[cfg(windows)]
    fn archive_write_open_filename_w(a: *mut c_void, path: *const u16) -> c_int;
    fn archive_write_header(a: *mut c_void, entry: *mut c_void) -> c_int;
    fn archive_write_data(a: *mut c_void, buffer: *const c_void, size: usize) -> isize;
    fn archive_write_finish_entry(a: *mut c_void) -> c_int;
    fn archive_write_close(a: *mut c_void) -> c_int;
    fn archive_write_free(a: *mut c_void) -> c_int;
    fn archive_error_string(a: *mut c_void) -> *const c_char;
    fn archive_entry_new() -> *mut c_void;
    fn archive_entry_free(entry: *mut c_void);
    fn archive_entry_set_pathname_utf8(entry: *mut c_void, path: *const c_char);
    fn archive_entry_set_filetype(entry: *mut c_void, kind: u32);
    fn archive_entry_set_perm(entry: *mut c_void, permissions: ArchiveMode);
    fn archive_entry_set_size(entry: *mut c_void, size: i64);
    fn archive_entry_set_mtime(entry: *mut c_void, seconds: i64, nanoseconds: std::ffi::c_long);
}

const ARCHIVE_OK: c_int = 0;
const FILE_TYPE_REGULAR: u32 = 0o100000;
const FILE_TYPE_DIRECTORY: u32 = 0o040000;
static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProgress {
    pub phase: String,
    pub completed_bytes: u64,
    pub total_bytes: u64,
    pub completed_entries: usize,
    pub total_entries: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateResult {
    pub path: String,
    pub entries: usize,
    pub size: u64,
}

struct SourceEntry {
    path: PathBuf,
    archive_path: String,
    metadata: Option<Metadata>,
    directory: bool,
}

struct Writer(*mut c_void);

impl Writer {
    fn error(&self) -> String {
        unsafe {
            let message = archive_error_string(self.0);
            if message.is_null() {
                "ZIP 파일을 생성하지 못했습니다.".into()
            } else {
                CStr::from_ptr(message).to_string_lossy().into_owned()
            }
        }
    }
}

impl Drop for Writer {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe {
                archive_write_free(self.0);
            }
        }
    }
}

struct Entry(*mut c_void);

impl Drop for Entry {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe {
                archive_entry_free(self.0);
            }
        }
    }
}

struct TemporaryOutput(PathBuf);

impl Drop for TemporaryOutput {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

fn c_string(value: &str, message: &str) -> Result<CString, String> {
    CString::new(value).map_err(|_| message.to_string())
}

fn entry_name(name: &std::ffi::OsStr) -> Result<String, String> {
    name.to_str()
        .filter(|value| !value.is_empty() && *value != "." && *value != "..")
        .map(str::to_string)
        .ok_or_else(|| "UTF-8로 표현할 수 없는 파일 이름은 압축할 수 없습니다.".into())
}

fn push_source(
    path: PathBuf,
    name: String,
    metadata: Metadata,
    directory: bool,
    entries: &mut Vec<SourceEntry>,
    names: &mut HashSet<String>,
) -> Result<(), String> {
    if entries.len() >= 100_000 {
        return Err("압축할 항목이 최대 한도(10만 개)를 초과합니다.".into());
    }
    let normalized = name.to_lowercase();
    if !names.insert(normalized) {
        return Err(format!("압축 항목 이름이 중복됩니다: {name}"));
    }
    entries.push(SourceEntry {
        path,
        archive_path: name,
        metadata: Some(metadata),
        directory,
    });
    Ok(())
}

fn collect_directory(
    root: &Path,
    entries: &mut Vec<SourceEntry>,
    names: &mut HashSet<String>,
    cancelled: &AtomicBool,
) -> Result<(), String> {
    let root_name = entry_name(root.file_name().ok_or("폴더 이름을 읽을 수 없습니다.")?)?;
    let root_metadata = fs::symlink_metadata(root).map_err(|error| error.to_string())?;
    push_source(
        root.to_path_buf(),
        format!("{root_name}/"),
        root_metadata,
        true,
        entries,
        names,
    )?;
    let mut pending = vec![(root.to_path_buf(), root_name)];
    while let Some((directory, archive_directory)) = pending.pop() {
        if cancelled.load(Ordering::Relaxed) {
            return Err("압축 작업이 취소되었습니다.".into());
        }
        let mut children = fs::read_dir(&directory)
            .map_err(|error| format!("폴더를 읽지 못했습니다: {} ({error})", directory.display()))?
            .map(|item| {
                item.map(|entry| entry.path())
                    .map_err(|error| error.to_string())
            })
            .collect::<Result<Vec<_>, _>>()?;
        children.sort();
        for child in children.into_iter().rev() {
            let metadata = fs::symlink_metadata(&child).map_err(|error| error.to_string())?;
            if metadata.file_type().is_symlink() {
                return Err(format!(
                    "심볼릭 링크는 현재 압축할 수 없습니다: {}",
                    child.display()
                ));
            }
            let child_name = entry_name(child.file_name().ok_or("파일 이름을 읽을 수 없습니다.")?)?;
            let name = format!("{archive_directory}/{child_name}");
            if metadata.is_dir() {
                push_source(
                    child.clone(),
                    format!("{name}/"),
                    metadata,
                    true,
                    entries,
                    names,
                )?;
                pending.push((child, name));
            } else if metadata.is_file() {
                push_source(child, name, metadata, false, entries, names)?;
            } else {
                return Err(format!(
                    "일반 파일과 폴더만 압축할 수 있습니다: {}",
                    child.display()
                ));
            }
        }
    }
    Ok(())
}

fn collect_sources(paths: &[PathBuf], cancelled: &AtomicBool) -> Result<Vec<SourceEntry>, String> {
    if paths.is_empty() {
        return Err("압축할 파일을 추가하세요.".into());
    }
    let mut entries = Vec::new();
    let mut names = HashSet::new();
    let mut sources = HashSet::new();
    for path in paths {
        if cancelled.load(Ordering::Relaxed) {
            return Err("압축 작업이 취소되었습니다.".into());
        }
        if fs::symlink_metadata(path)
            .map_err(|error| error.to_string())?
            .file_type()
            .is_symlink()
        {
            return Err("심볼릭 링크는 현재 압축할 수 없습니다.".into());
        }
        let canonical = fs::canonicalize(path).map_err(|error| {
            format!(
                "입력 항목에 접근할 수 없습니다: {} ({error})",
                path.display()
            )
        })?;
        if !sources.insert(canonical.clone()) {
            continue;
        }
        let metadata = fs::symlink_metadata(&canonical).map_err(|error| error.to_string())?;
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "심볼릭 링크는 현재 압축할 수 없습니다: {}",
                path.display()
            ));
        }
        if metadata.is_dir() {
            collect_directory(&canonical, &mut entries, &mut names, cancelled)?;
        } else if metadata.is_file() {
            let name = entry_name(
                canonical
                    .file_name()
                    .ok_or("파일 이름을 읽을 수 없습니다.")?,
            )?;
            push_source(canonical, name, metadata, false, &mut entries, &mut names)?;
        } else {
            return Err(format!(
                "일반 파일과 폴더만 압축할 수 있습니다: {}",
                path.display()
            ));
        }
    }
    Ok(entries)
}

fn temporary_path(output: &Path) -> Result<PathBuf, String> {
    let parent = output
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let name = output
        .file_name()
        .ok_or("저장 파일 이름이 올바르지 않습니다.")?;
    for _ in 0..100 {
        let mut candidate = name.to_os_string();
        candidate.push(format!(
            ".silk-zip-{}-{}.part",
            std::process::id(),
            TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let candidate = parent.join(candidate);
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err("임시 압축 파일 이름을 만들지 못했습니다.".into())
}

fn open_writer(writer: &Writer, path: &Path) -> Result<(), String> {
    #[cfg(windows)]
    let status = {
        use std::os::windows::ffi::OsStrExt;
        let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        unsafe { archive_write_open_filename_w(writer.0, wide.as_ptr()) }
    };
    #[cfg(not(windows))]
    let status = {
        use std::os::unix::ffi::OsStrExt;
        let path =
            CString::new(path.as_os_str().as_bytes()).map_err(|_| "잘못된 저장 경로입니다.")?;
        unsafe { archive_write_open_filename(writer.0, path.as_ptr()) }
    };
    if status == ARCHIVE_OK {
        Ok(())
    } else {
        Err(writer.error())
    }
}

fn set_entry(writer: &Writer, source: &SourceEntry) -> Result<Entry, String> {
    let name = c_string(&source.archive_path, "압축 항목 이름이 올바르지 않습니다.")?;
    let entry = Entry(unsafe { archive_entry_new() });
    if entry.0.is_null() {
        return Err("압축 항목을 생성하지 못했습니다.".into());
    }
    let size = if source.directory {
        0
    } else {
        source.metadata.as_ref().map_or(0, Metadata::len)
    };
    let size = i64::try_from(size).map_err(|_| "파일 크기가 ZIP 형식의 한도를 초과합니다.")?;
    let modified = source
        .metadata
        .as_ref()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .unwrap_or_default();
    unsafe {
        archive_entry_set_pathname_utf8(entry.0, name.as_ptr());
        archive_entry_set_filetype(
            entry.0,
            if source.directory {
                FILE_TYPE_DIRECTORY
            } else {
                FILE_TYPE_REGULAR
            },
        );
        archive_entry_set_perm(
            entry.0,
            if source.directory {
                0o755 as ArchiveMode
            } else {
                0o644 as ArchiveMode
            },
        );
        archive_entry_set_size(entry.0, size);
        archive_entry_set_mtime(
            entry.0,
            modified.as_secs().min(i64::MAX as u64) as i64,
            modified.subsec_nanos() as std::ffi::c_long,
        );
        if archive_write_header(writer.0, entry.0) != ARCHIVE_OK {
            return Err(writer.error());
        }
    }
    Ok(entry)
}

fn replace_output(temporary: &Path, output: &Path) -> Result<(), String> {
    if !output.exists() {
        return fs::rename(temporary, output)
            .map_err(|error| format!("압축 파일을 저장하지 못했습니다: {error}"));
    }
    if !output.is_file() {
        return Err("저장 위치에 같은 이름의 파일이 아닌 항목이 있습니다.".into());
    }
    let backup = temporary_path(output)?.with_extension("silk-zip-backup");
    if backup.exists() {
        return Err("기존 압축 파일을 안전하게 보관할 임시 경로를 만들지 못했습니다.".into());
    }
    fs::rename(output, &backup)
        .map_err(|error| format!("기존 파일을 보관하지 못했습니다: {error}"))?;
    match fs::rename(temporary, output) {
        Ok(()) => {
            let _ = fs::remove_file(backup);
            Ok(())
        }
        Err(error) => {
            let restore = fs::rename(&backup, output);
            if let Err(restore_error) = restore {
                return Err(format!("새 압축 파일 저장에 실패했고 기존 파일 복원도 실패했습니다: {error}; {restore_error}"));
            }
            Err(format!("압축 파일을 저장하지 못했습니다: {error}"))
        }
    }
}

/// Create a ZIP archive. Input files are stored by basename; selected folders
/// keep their top-level directory and relative contents.
pub fn create_zip<F>(
    input_paths: &[PathBuf],
    output_path: &Path,
    compression_level: u8,
    password: Option<&str>,
    cancelled: &Arc<AtomicBool>,
    on_progress: F,
) -> Result<CreateResult, String>
where
    F: FnMut(CreateProgress),
{
    let sources = collect_sources(input_paths, cancelled)?;
    write_zip(
        sources,
        output_path,
        compression_level,
        password,
        cancelled,
        on_progress,
    )
}

/// An explicit archive entry. A missing source creates an empty directory.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateInput {
    pub source_path: Option<PathBuf>,
    pub archive_path: String,
}

pub fn create_zip_entries<F: FnMut(CreateProgress)>(
    inputs: &[CreateInput],
    output_path: &Path,
    compression_level: u8,
    password: Option<&str>,
    cancelled: &Arc<AtomicBool>,
    on_progress: F,
) -> Result<CreateResult, String> {
    let mut sources = Vec::new();
    let mut names = HashSet::new();
    for input in inputs {
        if cancelled.load(Ordering::Relaxed) {
            return Err("압축 작업이 취소되었습니다.".into());
        }
        let name = input.archive_path.trim_end_matches('/');
        if name.is_empty()
            || name.contains(['\\', ':', '\0'])
            || name
                .split('/')
                .any(|part| part.is_empty() || part == "." || part == "..")
        {
            return Err("압축 내부 경로가 올바르지 않습니다.".into());
        }
        if sources.len() >= 100_000 || !names.insert(name.to_lowercase()) {
            return Err(format!(
                "압축 항목이 중복되거나 최대 개수를 초과합니다: {name}"
            ));
        }
        let metadata = input
            .source_path
            .as_ref()
            .map(fs::symlink_metadata)
            .transpose()
            .map_err(|error| error.to_string())?;
        if metadata.as_ref().is_some_and(|value| {
            value.file_type().is_symlink() || (!value.is_dir() && !value.is_file())
        }) {
            return Err("일반 파일과 폴더만 압축할 수 있습니다.".into());
        }
        let directory = metadata.as_ref().is_none_or(Metadata::is_dir);
        sources.push(SourceEntry {
            path: input.source_path.clone().unwrap_or_default(),
            archive_path: if directory {
                format!("{name}/")
            } else {
                name.into()
            },
            metadata,
            directory,
        });
    }
    let file_names: HashSet<String> = sources
        .iter()
        .filter(|entry| !entry.directory)
        .map(|entry| entry.archive_path.to_lowercase())
        .collect();
    for entry in &sources {
        let mut parent = entry.archive_path.trim_end_matches('/');
        while let Some((prefix, _)) = parent.rsplit_once('/') {
            if file_names.contains(&prefix.to_lowercase()) {
                return Err("파일 아래에 항목을 추가할 수 없습니다.".into());
            }
            parent = prefix;
        }
    }
    write_zip(
        sources,
        output_path,
        compression_level,
        password,
        cancelled,
        on_progress,
    )
}

fn write_zip<F: FnMut(CreateProgress)>(
    sources: Vec<SourceEntry>,
    output_path: &Path,
    compression_level: u8,
    password: Option<&str>,
    cancelled: &Arc<AtomicBool>,
    mut on_progress: F,
) -> Result<CreateResult, String> {
    if !matches!(compression_level, 1 | 6 | 9) {
        return Err("지원하지 않는 ZIP 압축 수준입니다.".into());
    }
    if !output_path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("zip"))
    {
        return Err("현재 생성할 수 있는 형식은 ZIP입니다.".into());
    }
    let output_parent = output_path
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    if !output_parent.is_dir() {
        return Err("저장할 폴더가 존재하지 않습니다.".into());
    }
    if output_path.exists() && !output_path.is_file() {
        return Err("저장 위치에 같은 이름의 파일이 아닌 항목이 있습니다.".into());
    }
    on_progress(CreateProgress {
        phase: "preparing".into(),
        completed_bytes: 0,
        total_bytes: 0,
        completed_entries: 0,
        total_entries: 0,
    });
    if sources.is_empty() {
        return Err("압축할 파일이 없습니다.".into());
    }
    if output_path.exists() {
        let output_canonical = fs::canonicalize(output_path).map_err(|error| error.to_string())?;
        if sources
            .iter()
            .any(|source| fs::canonicalize(&source.path).ok().as_ref() == Some(&output_canonical))
        {
            return Err("압축 파일을 입력 파일과 같은 경로에 저장할 수 없습니다.".into());
        }
    }
    let total_bytes = sources
        .iter()
        .filter(|source| !source.directory)
        .try_fold(0u64, |total, source| {
            total.checked_add(source.metadata.as_ref().map_or(0, Metadata::len))
        })
        .ok_or("압축할 전체 파일 크기가 너무 큽니다.")?;
    on_progress(CreateProgress {
        phase: "writing".into(),
        completed_bytes: 0,
        total_bytes,
        completed_entries: 0,
        total_entries: sources.len(),
    });

    let temporary = temporary_path(output_path)?;
    let cleanup = TemporaryOutput(temporary.clone());
    let handle = unsafe { archive_write_new() };
    if handle.is_null() {
        return Err("압축 엔진을 초기화하지 못했습니다.".into());
    }
    let writer = Writer(handle);
    unsafe {
        if archive_write_set_format_zip(writer.0) != ARCHIVE_OK
            || archive_write_add_filter_none(writer.0) != ARCHIVE_OK
        {
            return Err(writer.error());
        }
    }
    let options = c_string(
        &format!("zip:hdrcharset=UTF-8,zip:compression-level={compression_level}"),
        "ZIP 옵션이 올바르지 않습니다.",
    )?;
    if unsafe { archive_write_set_options(writer.0, options.as_ptr()) } != ARCHIVE_OK {
        return Err(writer.error());
    }
    if let Some(password) = password.filter(|value| !value.is_empty()) {
        let passphrase = c_string(password, "암호에 지원하지 않는 문자가 포함되어 있습니다.")?;
        let encryption = c_string(
            "zip:encryption=zipcrypt",
            "ZIP 암호화 설정이 올바르지 않습니다.",
        )?;
        if unsafe { archive_write_set_options(writer.0, encryption.as_ptr()) } != ARCHIVE_OK
            || unsafe { archive_write_set_passphrase(writer.0, passphrase.as_ptr()) } != ARCHIVE_OK
        {
            return Err(writer.error());
        }
    }
    open_writer(&writer, &temporary)?;

    let mut completed_bytes = 0u64;
    for (index, source) in sources.iter().enumerate() {
        if cancelled.load(Ordering::Relaxed) {
            return Err("압축 작업이 취소되었습니다.".into());
        }
        let entry = set_entry(&writer, source)?;
        if !source.directory {
            let mut file = File::open(&source.path).map_err(|error| {
                format!(
                    "파일을 읽지 못했습니다: {} ({error})",
                    source.path.display()
                )
            })?;
            let mut remaining = source.metadata.as_ref().map_or(0, Metadata::len);
            let mut buffer = [0u8; 128 * 1024];
            while remaining > 0 {
                if cancelled.load(Ordering::Relaxed) {
                    return Err("압축 작업이 취소되었습니다.".into());
                }
                let requested = buffer
                    .len()
                    .min(remaining.min(buffer.len() as u64) as usize);
                let read = file.read(&mut buffer[..requested]).map_err(|error| {
                    format!(
                        "파일을 읽지 못했습니다: {} ({error})",
                        source.path.display()
                    )
                })?;
                if read == 0 {
                    return Err(format!(
                        "압축 중 파일 크기가 변경되었습니다: {}",
                        source.path.display()
                    ));
                }
                let mut offset = 0;
                while offset < read {
                    let written = unsafe {
                        archive_write_data(
                            writer.0,
                            buffer[offset..read].as_ptr().cast(),
                            read - offset,
                        )
                    };
                    if written <= 0 {
                        return Err(writer.error());
                    }
                    offset += written as usize;
                }
                remaining -= read as u64;
                completed_bytes += read as u64;
                on_progress(CreateProgress {
                    phase: "writing".into(),
                    completed_bytes,
                    total_bytes,
                    completed_entries: index,
                    total_entries: sources.len(),
                });
            }
            if file.metadata().map_err(|error| error.to_string())?.len()
                != source.metadata.as_ref().map_or(0, Metadata::len)
            {
                return Err(format!(
                    "압축 중 파일 크기가 변경되었습니다: {}",
                    source.path.display()
                ));
            }
        }
        drop(entry);
        if unsafe { archive_write_finish_entry(writer.0) } != ARCHIVE_OK {
            return Err(writer.error());
        }
        on_progress(CreateProgress {
            phase: "writing".into(),
            completed_bytes,
            total_bytes,
            completed_entries: index + 1,
            total_entries: sources.len(),
        });
    }
    if cancelled.load(Ordering::Relaxed) {
        return Err("압축 작업이 취소되었습니다.".into());
    }
    on_progress(CreateProgress {
        phase: "finalizing".into(),
        completed_bytes,
        total_bytes,
        completed_entries: sources.len(),
        total_entries: sources.len(),
    });
    if unsafe { archive_write_close(writer.0) } != ARCHIVE_OK {
        return Err(writer.error());
    }
    drop(writer);
    replace_output(&temporary, output_path)?;
    drop(cleanup);
    let size = fs::metadata(output_path)
        .map_err(|error| error.to_string())?
        .len();
    Ok(CreateResult {
        path: output_path.to_string_lossy().into_owned(),
        entries: sources.len(),
        size,
    })
}
