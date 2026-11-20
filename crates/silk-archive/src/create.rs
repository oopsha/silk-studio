//! Shared ZIP creation support backed by the 7-Zip SDK.
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    ffi::{c_char, c_int, c_void, CString},
    fs::{self, File, Metadata},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
    time::{Instant, UNIX_EPOCH},
};

unsafe extern "C" {
    fn silk_7zip_create_archive(
        format: u32,
        output_path: *const c_char,
        inputs: *const SdkInput,
        input_count: u32,
        compression_level: u32,
        password: *const c_char,
        total_bytes: u64,
        progress: Option<SdkProgressCallback>,
        progress_context: *mut c_void,
        timings: *mut SdkFileTiming,
    ) -> c_int;
    fn silk_7zip_gzip_file(
        input_path: *const c_char,
        output_path: *const c_char,
        name: *const c_char,
        modified_seconds: i64,
        level: u32,
        total_bytes: u64,
        progress: Option<SdkProgressCallback>,
        progress_context: *mut c_void,
    ) -> c_int;
}

/// Archive container written by the creation API.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ArchiveFormat {
    #[default]
    Zip,
    /// Uncompressed POSIX tar.
    Tar,
    /// A single file compressed as one gzip member.
    Gz,
    /// A tar stream compressed with gzip.
    Tgz,
    /// A single file compressed as one xz stream (LZMA2).
    Xz,
    /// A 7z archive (LZMA2, optional AES-256 with encrypted file names).
    #[serde(rename = "7z")]
    SevenZip,
}

impl ArchiveFormat {
    fn sdk_id(self) -> u32 {
        match self {
            Self::Zip => 0,
            Self::Tar => 1,
            Self::Xz => 2,
            Self::SevenZip => 3,
            Self::Gz | Self::Tgz => unreachable!("gzip formats do not use the SDK container writer"),
        }
    }

    fn extension(self) -> &'static str {
        match self {
            Self::Zip => "zip",
            Self::Tar => "tar",
            Self::Gz => "gz",
            Self::Tgz => "tgz",
            Self::Xz => "xz",
            Self::SevenZip => "7z",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Zip => "ZIP",
            Self::Tar => "TAR",
            Self::Gz => "GZ",
            Self::Tgz => "TGZ",
            Self::Xz => "XZ",
            Self::SevenZip => "7Z",
        }
    }
}

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

#[repr(C)]
struct SdkInput {
    source_path: *const c_char,
    archive_path: *const c_char,
    size: u64,
    modified_seconds: i64,
    is_directory: c_int,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct SdkFileTiming {
    opened_us: u64,
    released_us: u64,
}

pub struct ZipFileTiming {
    pub index: usize,
    pub size: u64,
    pub opened_us: u64,
    pub released_us: Option<u64>,
}

#[derive(Default)]
pub struct ZipDiagnostics {
    pub sdk_started_at: Option<Instant>,
    pub files: usize,
    pub folders: usize,
    pub empty_files: usize,
    pub timings: Vec<ZipFileTiming>,
}

type SdkProgressCallback = unsafe extern "C" fn(u64, u64, u32, u32, *mut c_void) -> c_int;

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

struct TemporaryOutput(PathBuf);

impl Drop for TemporaryOutput {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

struct TemporaryDirectory(PathBuf);

impl Drop for TemporaryDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

pub(crate) fn c_string(value: &str, message: &str) -> Result<CString, String> {
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

fn temporary_directory(output: &Path) -> Result<TemporaryDirectory, String> {
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
            ".silk-zip-{}-{}.parts",
            std::process::id(),
            TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let candidate = parent.join(candidate);
        match fs::create_dir(&candidate) {
            Ok(()) => return Ok(TemporaryDirectory(candidate)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("분할 압축 임시 폴더를 만들지 못했습니다: {error}")),
        }
    }
    Err("분할 압축 임시 폴더 이름을 만들지 못했습니다.".into())
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

fn split_volume_number(name: &str, stem: &str) -> Option<u64> {
    let prefix = format!("{stem}.z");
    let suffix = name.strip_prefix(&prefix)?;
    if suffix.is_empty() || !suffix.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    suffix.parse().ok()
}

fn existing_split_targets(output: &Path) -> Result<Vec<PathBuf>, String> {
    let parent = output
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let output_name = output
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("저장 파일 이름을 UTF-8로 처리할 수 없습니다.")?;
    let stem = output
        .file_stem()
        .and_then(|name| name.to_str())
        .ok_or("저장 파일 이름을 UTF-8로 처리할 수 없습니다.")?;
    let mut targets = Vec::new();
    for item in fs::read_dir(parent).map_err(|error| error.to_string())? {
        let path = item.map_err(|error| error.to_string())?.path();
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        let matches_output = if cfg!(windows) {
            name.eq_ignore_ascii_case(output_name)
        } else {
            name == output_name
        };
        let matches_volume = if cfg!(windows) {
            let lower_name = name.to_ascii_lowercase();
            let lower_stem = stem.to_ascii_lowercase();
            split_volume_number(&lower_name, &lower_stem).is_some()
        } else {
            split_volume_number(name, stem).is_some()
        };
        if matches_output || matches_volume {
            if !path.is_file() {
                return Err(format!(
                    "분할 압축 저장 경로에 파일이 아닌 항목이 있습니다: {}",
                    path.display()
                ));
            }
            targets.push(path);
        }
    }
    targets.sort_by(|left, right| {
        let left_name = left
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default();
        let right_name = right
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default();
        let left_number = split_volume_number(left_name, stem).unwrap_or(u64::MAX);
        let right_number = split_volume_number(right_name, stem).unwrap_or(u64::MAX);
        left_number.cmp(&right_number)
    });
    Ok(targets)
}

fn commit_split_outputs(stage: &Path, output: &Path) -> Result<u64, String> {
    let parent = output
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let output_name = output
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("저장 파일 이름을 UTF-8로 처리할 수 없습니다.")?;
    let stem = output
        .file_stem()
        .and_then(|name| name.to_str())
        .ok_or("저장 파일 이름을 UTF-8로 처리할 수 없습니다.")?;
    let mut outputs = fs::read_dir(stage)
        .map_err(|error| error.to_string())?
        .map(|item| {
            item.map(|item| item.path())
                .map_err(|error| error.to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    outputs.retain(|path| {
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            return false;
        };
        name == output_name || split_volume_number(name, stem).is_some()
    });
    if !outputs.iter().any(|path| {
        path.file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name == output_name)
    }) {
        return Err("분할 압축 엔진이 최종 ZIP 파일을 만들지 않았습니다.".into());
    }
    let total_size = outputs
        .iter()
        .try_fold(0u64, |total, path| {
            total.checked_add(fs::metadata(path).ok()?.len())
        })
        .ok_or("분할 압축 파일 크기를 계산하지 못했습니다.")?;
    outputs.sort_by(|left, right| {
        let left_name = left
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default();
        let right_name = right
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default();
        let left_number = split_volume_number(left_name, stem).unwrap_or(u64::MAX);
        let right_number = split_volume_number(right_name, stem).unwrap_or(u64::MAX);
        left_number.cmp(&right_number)
    });

    let existing = existing_split_targets(output)?;
    let backup = stage.join(".previous-output");
    fs::create_dir(&backup).map_err(|error| error.to_string())?;
    let mut backed_up = Vec::<(PathBuf, PathBuf)>::new();
    for target in existing {
        let name = target
            .file_name()
            .ok_or("기존 분할 파일 이름을 읽지 못했습니다.")?;
        let backup_path = backup.join(name);
        if let Err(error) = fs::rename(&target, &backup_path) {
            for (original, saved) in backed_up.iter().rev() {
                let _ = fs::rename(saved, original);
            }
            return Err(format!(
                "기존 분할 압축 파일을 보관하지 못했습니다: {error}"
            ));
        }
        backed_up.push((target, backup_path));
    }

    let mut installed = Vec::<(PathBuf, PathBuf)>::new();
    for source in outputs {
        let Some(name) = source.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        let destination = if name == output_name {
            output.to_path_buf()
        } else {
            parent.join(name)
        };
        if let Err(error) = fs::rename(&source, &destination) {
            for (original, destination) in installed.iter().rev() {
                let _ = fs::rename(destination, original);
            }
            for (original, saved) in backed_up.iter().rev() {
                if let Err(restore_error) = fs::rename(saved, original) {
                    return Err(format!(
                        "새 분할 압축 파일 저장 실패 후 기존 파일 복원도 실패했습니다: {error}; {restore_error}"
                    ));
                }
            }
            return Err(format!("분할 압축 파일을 저장하지 못했습니다: {error}"));
        }
        installed.push((source, destination));
    }
    Ok(total_size)
}

fn zip_u16(bytes: &[u8], offset: usize) -> Result<u16, String> {
    let value = bytes
        .get(offset..offset + 2)
        .ok_or("ZIP 구조가 잘못되었습니다.")?;
    Ok(u16::from_le_bytes([value[0], value[1]]))
}

fn zip_u32(bytes: &[u8], offset: usize) -> Result<u32, String> {
    let value = bytes
        .get(offset..offset + 4)
        .ok_or("ZIP 구조가 잘못되었습니다.")?;
    Ok(u32::from_le_bytes([value[0], value[1], value[2], value[3]]))
}

fn put_u16(bytes: &mut [u8], offset: usize, value: u16) {
    bytes[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
}

fn put_u32(bytes: &mut [u8], offset: usize, value: u32) {
    bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}

fn zip_u64(bytes: &[u8], offset: usize) -> Result<u64, String> {
    let value = bytes
        .get(offset..offset + 8)
        .ok_or("ZIP64 구조가 잘못되었습니다.")?;
    Ok(u64::from_le_bytes(value.try_into().unwrap()))
}

fn put_u64(bytes: &mut [u8], offset: usize, value: u64) {
    bytes[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
}

fn central_zip64_sizes(record: &[u8]) -> Result<(u64, u64), String> {
    let mut uncompressed = zip_u32(record, 24)? as u64;
    let mut compressed = zip_u32(record, 20)? as u64;
    let need_uncompressed = uncompressed == u32::MAX as u64;
    let need_compressed = compressed == u32::MAX as u64;
    if !need_uncompressed && !need_compressed {
        return Ok((uncompressed, compressed));
    }
    let name_len = zip_u16(record, 28)? as usize;
    let extra_len = zip_u16(record, 30)? as usize;
    let extra_start = 46 + name_len;
    let extra_end = extra_start
        .checked_add(extra_len)
        .filter(|end| *end <= record.len())
        .ok_or("ZIP 중앙 디렉터리 추가 정보가 잘못되었습니다.")?;
    let mut cursor = extra_start;
    while cursor + 4 <= extra_end {
        let id = zip_u16(record, cursor)?;
        let size = zip_u16(record, cursor + 2)? as usize;
        let data = cursor + 4;
        let end = data
            .checked_add(size)
            .filter(|end| *end <= extra_end)
            .ok_or("ZIP 추가 정보 항목 길이가 잘못되었습니다.")?;
        if id == 0x0001 {
            let mut value = data;
            if need_uncompressed {
                if value + 8 > end {
                    return Err("ZIP64 원본 크기 정보가 누락되었습니다.".into());
                }
                uncompressed = zip_u64(record, value)?;
                value += 8;
            }
            if need_compressed {
                if value + 8 > end {
                    return Err("ZIP64 압축 크기 정보가 누락되었습니다.".into());
                }
                compressed = zip_u64(record, value)?;
            }
            return Ok((uncompressed, compressed));
        }
        cursor = end;
    }
    Err("ZIP64 크기 정보가 누락되었습니다.".into())
}

fn central_zip64_location(record: &[u8]) -> Result<(u64, u32), String> {
    let offset32 = zip_u32(record, 42)?;
    let disk16 = zip_u16(record, 34)?;
    if offset32 != u32::MAX && disk16 != u16::MAX {
        return Ok((offset32 as u64, disk16 as u32));
    }
    let name_len = zip_u16(record, 28)? as usize;
    let extra_len = zip_u16(record, 30)? as usize;
    let extra_start = 46 + name_len;
    let extra_end = extra_start
        .checked_add(extra_len)
        .filter(|end| *end <= record.len())
        .ok_or("ZIP 중앙 디렉터리 추가 정보가 잘못되었습니다.")?;
    let mut cursor = extra_start;
    while cursor + 4 <= extra_end {
        let id = zip_u16(record, cursor)?;
        let size = zip_u16(record, cursor + 2)? as usize;
        let data = cursor + 4;
        let end = data
            .checked_add(size)
            .filter(|end| *end <= extra_end)
            .ok_or("ZIP 추가 정보 항목 길이가 잘못되었습니다.")?;
        if id == 0x0001 {
            let mut value = data;
            if zip_u32(record, 24)? == u32::MAX {
                value += 8;
            }
            if zip_u32(record, 20)? == u32::MAX {
                value += 8;
            }
            let offset = if offset32 == u32::MAX {
                let parsed = zip_u64(record, value)?;
                value += 8;
                parsed
            } else {
                offset32 as u64
            };
            let disk = if disk16 == u16::MAX {
                let bytes = record
                    .get(value..value + 4)
                    .filter(|_| value + 4 <= end)
                    .ok_or("ZIP64 시작 디스크 정보가 누락되었습니다.")?;
                u32::from_le_bytes(bytes.try_into().unwrap())
            } else {
                disk16 as u32
            };
            return Ok((offset, disk));
        }
        cursor = end;
    }
    Err("ZIP64 로컬 헤더 위치 정보가 누락되었습니다.".into())
}

fn patch_central_location(record: &mut [u8], disk: u16, offset: u32) -> Result<(), String> {
    let old_offset = zip_u32(record, 42)?;
    let old_disk = zip_u16(record, 34)?;
    if old_offset != u32::MAX {
        put_u32(record, 42, offset);
    }
    if old_disk != u16::MAX {
        put_u16(record, 34, disk);
    }
    if old_offset != u32::MAX && old_disk != u16::MAX {
        return Ok(());
    }
    let name_len = zip_u16(record, 28)? as usize;
    let extra_len = zip_u16(record, 30)? as usize;
    let extra_start = 46 + name_len;
    let extra_end = extra_start
        .checked_add(extra_len)
        .filter(|end| *end <= record.len())
        .ok_or("ZIP 중앙 디렉터리 추가 정보가 잘못되었습니다.")?;
    let mut cursor = extra_start;
    while cursor + 4 <= extra_end {
        let id = zip_u16(record, cursor)?;
        let size = zip_u16(record, cursor + 2)? as usize;
        let data = cursor + 4;
        let end = data
            .checked_add(size)
            .filter(|end| *end <= extra_end)
            .ok_or("ZIP 추가 정보 항목 길이가 잘못되었습니다.")?;
        if id == 0x0001 {
            let mut value = data;
            if zip_u32(record, 24)? == u32::MAX {
                value = value
                    .checked_add(8)
                    .ok_or("ZIP64 추가 정보 위치가 잘못되었습니다.")?;
            }
            if zip_u32(record, 20)? == u32::MAX {
                value = value
                    .checked_add(8)
                    .ok_or("ZIP64 추가 정보 위치가 잘못되었습니다.")?;
            }
            if old_offset == u32::MAX {
                if value + 8 > end {
                    return Err("ZIP64 로컬 헤더 위치 정보가 누락되었습니다.".into());
                }
                put_u64(record, value, offset as u64);
                value += 8;
            }
            if old_disk == u16::MAX {
                if value + 4 > end {
                    return Err("ZIP64 디스크 번호 정보가 누락되었습니다.".into());
                }
                record[value..value + 4].copy_from_slice(&(disk as u32).to_le_bytes());
            }
            return Ok(());
        }
        cursor = end;
    }
    Err("ZIP64 중앙 디렉터리 추가 정보가 누락되었습니다.".into())
}

fn read_data_descriptor(
    input: &mut File,
    position: u64,
    limit: u64,
    crc: u32,
    compressed: u64,
    uncompressed: u64,
) -> Result<Vec<u8>, String> {
    let available = limit.saturating_sub(position).min(24) as usize;
    if available < 12 {
        return Err("ZIP 데이터 설명자가 잘렸습니다.".into());
    }
    let mut bytes = vec![0; available];
    input
        .seek(SeekFrom::Start(position))
        .map_err(|error| error.to_string())?;
    input
        .read_exact(&mut bytes)
        .map_err(|error| error.to_string())?;
    let mut candidates = Vec::new();
    for signed in [true, false] {
        for zip64 in [true, false] {
            let start = if signed { 4 } else { 0 };
            let length = start + 4 + if zip64 { 16 } else { 8 };
            if length > bytes.len() || (signed && zip_u32(&bytes, 0).ok() != Some(0x0807_4b50)) {
                continue;
            }
            let found_crc = zip_u32(&bytes, start)?;
            let found_compressed = if zip64 {
                zip_u64(&bytes, start + 4)?
            } else {
                zip_u32(&bytes, start + 4)? as u64
            };
            let found_uncompressed = if zip64 {
                zip_u64(&bytes, start + 12)?
            } else {
                zip_u32(&bytes, start + 8)? as u64
            };
            if found_crc == crc
                && found_compressed == compressed
                && found_uncompressed == uncompressed
            {
                candidates.push(length);
            }
        }
    }
    let length = candidates
        .into_iter()
        .max()
        .ok_or("ZIP 데이터 설명자 값이 중앙 디렉터리와 일치하지 않습니다.")?;
    Ok(bytes[..length].to_vec())
}

struct ZipVolumeWriter<'a> {
    stage: &'a Path,
    stem: &'a str,
    output_name: &'a std::ffi::OsStr,
    limit: u64,
    disk: u16,
    length: u64,
    file: Option<File>,
    paths: Vec<PathBuf>,
}

impl<'a> ZipVolumeWriter<'a> {
    fn new(
        stage: &'a Path,
        stem: &'a str,
        output_name: &'a std::ffi::OsStr,
        limit: u64,
    ) -> Result<Self, String> {
        let mut writer = Self {
            stage,
            stem,
            output_name,
            limit: limit.min(u32::MAX as u64 - 1),
            disk: 0,
            length: 0,
            file: None,
            paths: Vec::new(),
        };
        writer.open_disk()?;
        writer.write_payload(&0x0807_4b50u32.to_le_bytes())?;
        Ok(writer)
    }

    fn open_disk(&mut self) -> Result<(), String> {
        if self.disk >= u16::MAX {
            return Err("PKWARE 분할 ZIP의 디스크 수 한도를 초과했습니다.".into());
        }
        let path = self
            .stage
            .join(format!("{}.z{:02}", self.stem, self.disk + 1));
        self.file = Some(File::create(&path).map_err(|error| error.to_string())?);
        self.length = 0;
        self.paths.push(path);
        Ok(())
    }

    fn next_disk(&mut self) -> Result<(), String> {
        self.file.take();
        self.disk = self
            .disk
            .checked_add(1)
            .ok_or("분할 ZIP 디스크 번호가 너무 큽니다.")?;
        self.open_disk()
    }

    fn ensure_record_room(&mut self, size: u64) -> Result<(), String> {
        if size > self.limit {
            return Err("ZIP 헤더 또는 중앙 디렉터리 항목이 분할 크기보다 큽니다.".into());
        }
        if self
            .length
            .checked_add(size)
            .is_none_or(|end| end > self.limit)
        {
            self.next_disk()?;
        }
        Ok(())
    }

    fn write_record(&mut self, record: &[u8]) -> Result<(u16, u32), String> {
        self.ensure_record_room(record.len() as u64)?;
        let position = (
            self.disk,
            u32::try_from(self.length).map_err(|_| "ZIP 조각 내 위치가 너무 큽니다.")?,
        );
        self.file
            .as_mut()
            .ok_or("분할 ZIP 출력이 닫혔습니다.")?
            .write_all(record)
            .map_err(|error| error.to_string())?;
        self.length += record.len() as u64;
        Ok(position)
    }

    fn write_payload(&mut self, mut bytes: &[u8]) -> Result<(), String> {
        while !bytes.is_empty() {
            if self.length == self.limit {
                self.next_disk()?;
            }
            let available = (self.limit - self.length).min(usize::MAX as u64) as usize;
            let count = available.min(bytes.len());
            self.file
                .as_mut()
                .ok_or("분할 ZIP 출력이 닫혔습니다.")?
                .write_all(&bytes[..count])
                .map_err(|error| error.to_string())?;
            self.length += count as u64;
            bytes = &bytes[count..];
        }
        Ok(())
    }

    fn finish(mut self) -> Result<Vec<PathBuf>, String> {
        self.file.take();
        let final_volume = self.paths.pop().ok_or("분할 ZIP 출력이 비어 있습니다.")?;
        let final_path = self.stage.join(self.output_name);
        fs::rename(final_volume, &final_path).map_err(|error| error.to_string())?;
        self.paths.push(final_path);
        Ok(self.paths)
    }
}

fn convert_zip_to_pkware_split(
    source: &Path,
    stage: &Path,
    output_path: &Path,
    split_size: u64,
    cancelled: &AtomicBool,
) -> Result<(), String> {
    let mut input = File::open(source).map_err(|error| error.to_string())?;
    let input_size = input.metadata().map_err(|error| error.to_string())?.len();
    if input_size <= split_size {
        let output_name = output_path
            .file_name()
            .ok_or("저장 파일 이름이 올바르지 않습니다.")?;
        fs::copy(source, stage.join(output_name)).map_err(|error| error.to_string())?;
        return Ok(());
    }
    let tail_size = input_size.min(65_557) as usize;
    input
        .seek(SeekFrom::End(-(tail_size as i64)))
        .map_err(|error| error.to_string())?;
    let mut tail = vec![0; tail_size];
    input
        .read_exact(&mut tail)
        .map_err(|error| error.to_string())?;
    let eocd_relative = tail
        .windows(4)
        .enumerate()
        .rev()
        .find_map(|(index, window)| {
            if window != [0x50, 0x4b, 0x05, 0x06] || tail.len().saturating_sub(index) < 22 {
                return None;
            }
            let comment_len = u16::from_le_bytes([tail[index + 20], tail[index + 21]]) as usize;
            (index + 22 + comment_len == tail.len()).then_some(index)
        })
        .ok_or("7-Zip SDK가 만든 ZIP의 끝 레코드를 찾지 못했습니다.")?;
    let eocd = tail[eocd_relative..].to_vec();
    if eocd.len() < 22 {
        return Err("ZIP 끝 레코드가 잘렸습니다.".into());
    }
    let eocd_absolute = input_size - tail_size as u64 + eocd_relative as u64;
    let mut entries = zip_u16(&eocd, 10)? as u64;
    let mut cd_size = zip_u32(&eocd, 12)? as u64;
    let mut cd_offset = zip_u32(&eocd, 16)? as u64;
    let mut zip64_present = false;
    if eocd_absolute >= 20 {
        input
            .seek(SeekFrom::Start(eocd_absolute - 20))
            .map_err(|error| error.to_string())?;
        let mut locator = [0u8; 20];
        input
            .read_exact(&mut locator)
            .map_err(|error| error.to_string())?;
        if zip_u32(&locator, 0)? == 0x0706_4b50 {
            zip64_present = true;
            let zip64_offset = zip_u64(&locator, 8)?;
            if zip_u32(&locator, 4)? != 0 || zip_u32(&locator, 16)? != 1 {
                return Err("변환 입력 ZIP64는 단일 디스크 형식이어야 합니다.".into());
            }
            if zip64_offset
                .checked_add(56)
                .is_none_or(|end| end > eocd_absolute - 20)
            {
                return Err("ZIP64 끝 레코드 위치가 잘못되었습니다.".into());
            }
            input
                .seek(SeekFrom::Start(zip64_offset))
                .map_err(|error| error.to_string())?;
            let mut zip64_end = [0u8; 56];
            input
                .read_exact(&mut zip64_end)
                .map_err(|error| error.to_string())?;
            let zip64_record_size = zip_u64(&zip64_end, 4)?;
            if zip_u32(&zip64_end, 0)? != 0x0606_4b50 || zip64_record_size < 44 {
                return Err("ZIP64 끝 레코드가 잘못되었습니다.".into());
            }
            if zip64_offset
                .checked_add(12)
                .and_then(|offset| offset.checked_add(zip64_record_size))
                != Some(eocd_absolute - 20)
            {
                return Err("ZIP64 끝 레코드와 위치 정보가 이어지지 않습니다.".into());
            }
            if zip_u32(&zip64_end, 16)? != 0 || zip_u32(&zip64_end, 20)? != 0 {
                return Err("변환 입력 ZIP64는 단일 디스크 형식이어야 합니다.".into());
            }
            entries = zip_u64(&zip64_end, 32)?;
            cd_size = zip_u64(&zip64_end, 40)?;
            cd_offset = zip_u64(&zip64_end, 48)?;
            if cd_offset
                .checked_add(cd_size)
                .is_none_or(|end| end > zip64_offset)
            {
                return Err("ZIP64 중앙 디렉터리 범위가 잘못되었습니다.".into());
            }
        }
    }
    if !zip64_present {
        if zip_u16(&eocd, 4)? != 0 || zip_u16(&eocd, 6)? != 0 {
            return Err("변환 입력 ZIP은 단일 디스크 형식이어야 합니다.".into());
        }
        if zip_u16(&eocd, 10)? == u16::MAX
            || zip_u32(&eocd, 12)? == u32::MAX
            || zip_u32(&eocd, 16)? == u32::MAX
        {
            return Err("ZIP64 끝 레코드 위치 정보가 누락되었습니다.".into());
        }
        if cd_offset
            .checked_add(cd_size)
            .is_none_or(|end| end > eocd_absolute)
        {
            return Err("ZIP 중앙 디렉터리 범위가 잘못되었습니다.".into());
        }
    }
    if entries > 100_000 {
        return Err("ZIP 항목이 지원 한도(10만 개)를 초과합니다.".into());
    }
    if cd_offset
        .checked_add(cd_size)
        .is_none_or(|end| end > eocd_absolute)
    {
        return Err("ZIP 중앙 디렉터리 범위가 잘못되었습니다.".into());
    }
    input
        .seek(SeekFrom::Start(cd_offset))
        .map_err(|error| error.to_string())?;
    let mut local_records = Vec::with_capacity(entries as usize);
    for _ in 0..entries {
        let mut header = [0u8; 46];
        input
            .read_exact(&mut header)
            .map_err(|error| error.to_string())?;
        if &header[..4] != b"PK\x01\x02" {
            return Err("ZIP 중앙 디렉터리 항목이 손상되었습니다.".into());
        }
        let name_len = zip_u16(&header, 28)? as usize;
        let extra_len = zip_u16(&header, 30)? as usize;
        let comment_len = zip_u16(&header, 32)? as usize;
        let record_len = 46usize
            .checked_add(name_len + extra_len + comment_len)
            .ok_or("ZIP 항목 길이가 너무 큽니다.")?;
        let mut record = vec![0; record_len];
        record[..46].copy_from_slice(&header);
        input
            .read_exact(&mut record[46..])
            .map_err(|error| error.to_string())?;
        let (uncompressed_size, compressed_size) = central_zip64_sizes(&record)?;
        let (local_offset, disk_start) = central_zip64_location(&record)?;
        if disk_start != 0 {
            return Err("변환 입력 ZIP 중앙 디렉터리가 여러 디스크에 있습니다.".into());
        }
        local_records.push((local_offset, compressed_size, uncompressed_size, record));
    }
    if input.stream_position().map_err(|error| error.to_string())? != cd_offset + cd_size {
        return Err("ZIP 중앙 디렉터리 크기와 항목 개수가 일치하지 않습니다.".into());
    }
    local_records.sort_by_key(|record| record.0);
    let stem = output_path
        .file_stem()
        .and_then(|name| name.to_str())
        .ok_or("저장 파일 이름이 올바르지 않습니다.")?;
    let output_name = output_path
        .file_name()
        .ok_or("저장 파일 이름이 올바르지 않습니다.")?;
    let mut writer = ZipVolumeWriter::new(stage, stem, output_name, split_size)?;
    let mut rewritten_central = Vec::with_capacity(entries as usize);
    let mut buffer = [0u8; 128 * 1024];
    let mut previous_local_end = 0u64;
    for (local_offset, compressed_size, uncompressed_size, mut central) in local_records {
        if cancelled.load(Ordering::Relaxed) {
            return Err("압축 작업이 취소되었습니다.".into());
        }
        if local_offset < previous_local_end || local_offset >= cd_offset {
            return Err("ZIP 로컬 항목의 위치가 겹치거나 잘못되었습니다.".into());
        }
        input
            .seek(SeekFrom::Start(local_offset))
            .map_err(|error| error.to_string())?;
        let mut local_header = [0u8; 30];
        input
            .read_exact(&mut local_header)
            .map_err(|error| error.to_string())?;
        if &local_header[..4] != b"PK\x03\x04" {
            return Err("ZIP 로컬 헤더가 손상되었습니다.".into());
        }
        let flags = zip_u16(&local_header, 6)?;
        let has_descriptor = flags & 0x0008 != 0;
        let name_len = zip_u16(&local_header, 26)? as usize;
        let extra_len = zip_u16(&local_header, 28)? as usize;
        let header_len = 30usize
            .checked_add(name_len + extra_len)
            .ok_or("ZIP 로컬 헤더 길이가 너무 큽니다.")?;
        let mut local = vec![0; header_len];
        local[..30].copy_from_slice(&local_header);
        input
            .read_exact(&mut local[30..])
            .map_err(|error| error.to_string())?;
        let local_compressed_size = zip_u32(&local_header, 18)? as u64;
        if !has_descriptor
            && local_compressed_size != u32::MAX as u64
            && local_compressed_size != compressed_size
        {
            return Err("ZIP 로컬 헤더와 중앙 디렉터리의 압축 크기가 다릅니다.".into());
        }
        let (disk, offset) = writer.write_record(&local)?;
        patch_central_location(&mut central, disk, offset)?;
        input
            .seek(SeekFrom::Start(local_offset + header_len as u64))
            .map_err(|error| error.to_string())?;
        let mut remaining = compressed_size;
        while remaining > 0 {
            if cancelled.load(Ordering::Relaxed) {
                return Err("압축 작업이 취소되었습니다.".into());
            }
            let count = remaining.min(buffer.len() as u64) as usize;
            input
                .read_exact(&mut buffer[..count])
                .map_err(|error| error.to_string())?;
            writer.write_payload(&buffer[..count])?;
            remaining -= count as u64;
        }
        let descriptor = if has_descriptor {
            let descriptor = read_data_descriptor(
                &mut input,
                local_offset + header_len as u64 + compressed_size,
                cd_offset,
                zip_u32(&central, 16)?,
                compressed_size,
                uncompressed_size,
            )?;
            writer.write_record(&descriptor)?;
            descriptor.len() as u64
        } else {
            0
        };
        previous_local_end = local_offset + header_len as u64 + compressed_size + descriptor;
        if previous_local_end > cd_offset {
            return Err("ZIP 로컬 항목이 중앙 디렉터리 영역과 겹칩니다.".into());
        }
        rewritten_central.push(central);
    }
    let mut entries_by_disk = Vec::<u64>::new();
    let (central_disk, central_offset) = writer.write_record(&rewritten_central[0])?;
    entries_by_disk.resize(writer.disk as usize + 1, 0);
    entries_by_disk[central_disk as usize] += 1;
    let central_start = central_offset as u64;
    let mut central_size = rewritten_central[0].len() as u64;
    for record in rewritten_central.iter().skip(1) {
        if cancelled.load(Ordering::Relaxed) {
            return Err("압축 작업이 취소되었습니다.".into());
        }
        writer.ensure_record_room(record.len() as u64)?;
        if entries_by_disk.len() <= writer.disk as usize {
            entries_by_disk.resize(writer.disk as usize + 1, 0);
        }
        writer
            .file
            .as_mut()
            .ok_or("분할 ZIP 출력이 닫혔습니다.")?
            .write_all(record)
            .map_err(|error| error.to_string())?;
        writer.length += record.len() as u64;
        central_size += record.len() as u64;
        entries_by_disk[writer.disk as usize] += 1;
    }
    let use_zip64 = zip64_present
        || entries >= u16::MAX as u64
        || central_size >= u32::MAX as u64
        || central_start >= u32::MAX as u64;
    let trailing_size = eocd.len() as u64 + if use_zip64 { 56 + 20 } else { 0 };
    writer.ensure_record_room(trailing_size)?;
    if entries_by_disk.len() <= writer.disk as usize {
        entries_by_disk.resize(writer.disk as usize + 1, 0);
    }
    let final_disk = writer.disk;
    let mut end = eocd;
    put_u16(&mut end, 4, final_disk);
    put_u16(&mut end, 6, central_disk);
    if use_zip64 {
        put_u16(&mut end, 8, u16::MAX);
        put_u16(&mut end, 10, u16::MAX);
        put_u32(&mut end, 12, u32::MAX);
        put_u32(&mut end, 16, u32::MAX);
        let zip64_offset = writer.length;
        let mut zip64_end = [0u8; 56];
        put_u32(&mut zip64_end, 0, 0x0606_4b50);
        put_u64(&mut zip64_end, 4, 44);
        put_u16(&mut zip64_end, 12, 45);
        put_u16(&mut zip64_end, 14, 45);
        zip64_end[16..20].copy_from_slice(&(final_disk as u32).to_le_bytes());
        zip64_end[20..24].copy_from_slice(&(central_disk as u32).to_le_bytes());
        put_u64(&mut zip64_end, 24, entries_by_disk[final_disk as usize]);
        put_u64(&mut zip64_end, 32, entries);
        put_u64(&mut zip64_end, 40, central_size);
        put_u64(&mut zip64_end, 48, central_start);
        let mut locator = [0u8; 20];
        put_u32(&mut locator, 0, 0x0706_4b50);
        put_u32(&mut locator, 4, final_disk as u32);
        put_u64(&mut locator, 8, zip64_offset);
        put_u32(&mut locator, 16, final_disk as u32 + 1);
        let file = writer.file.as_mut().ok_or("분할 ZIP 출력이 닫혔습니다.")?;
        file.write_all(&zip64_end)
            .map_err(|error| error.to_string())?;
        file.write_all(&locator)
            .map_err(|error| error.to_string())?;
        file.write_all(&end).map_err(|error| error.to_string())?;
        writer.length += trailing_size;
    } else {
        put_u16(
            &mut end,
            8,
            u16::try_from(entries_by_disk[final_disk as usize])
                .map_err(|_| "분할 디스크의 ZIP 항목 수가 너무 많습니다.")?,
        );
        put_u16(
            &mut end,
            10,
            u16::try_from(entries).map_err(|_| "ZIP 항목 수가 너무 많습니다.")?,
        );
        put_u32(
            &mut end,
            12,
            u32::try_from(central_size).map_err(|_| "ZIP 중앙 디렉터리가 너무 큽니다.")?,
        );
        put_u32(
            &mut end,
            16,
            u32::try_from(central_start).map_err(|_| "ZIP 중앙 디렉터리 위치가 너무 큽니다.")?,
        );
        writer
            .file
            .as_mut()
            .ok_or("분할 ZIP 출력이 닫혔습니다.")?
            .write_all(&end)
            .map_err(|error| error.to_string())?;
        writer.length += end.len() as u64;
    }
    if cancelled.load(Ordering::Relaxed) {
        return Err("압축 작업이 취소되었습니다.".into());
    }
    writer.finish()?;
    Ok(())
}

pub(crate) struct SdkProgressContext<'a, F> {
    pub(crate) cancelled: &'a AtomicBool,
    pub(crate) on_progress: &'a mut F,
}

pub(crate) unsafe extern "C" fn sdk_progress<F: FnMut(CreateProgress)>(
    completed_bytes: u64,
    total_bytes: u64,
    completed_entries: u32,
    total_entries: u32,
    context: *mut c_void,
) -> c_int {
    let context = &mut *context.cast::<SdkProgressContext<'_, F>>();
    if context.cancelled.load(Ordering::Relaxed) {
        return 1;
    }
    (context.on_progress)(CreateProgress {
        phase: "writing".into(),
        completed_bytes: completed_bytes.min(total_bytes),
        total_bytes,
        completed_entries: completed_entries as usize,
        total_entries: total_entries as usize,
    });
    c_int::from(context.cancelled.load(Ordering::Relaxed))
}

fn create_with_7zip_sdk<F: FnMut(CreateProgress)>(
    format: ArchiveFormat,
    sources: &[SourceEntry],
    temporary_path: &Path,
    compression_level: u8,
    password: Option<&str>,
    total_bytes: u64,
    cancelled: &AtomicBool,
    on_progress: &mut F,
    diagnostics: Option<&mut ZipDiagnostics>,
) -> Result<(), String> {
    let output_path = c_string(
        temporary_path
            .to_str()
            .ok_or("저장 경로를 UTF-8로 처리할 수 없습니다.")?,
        "저장 경로가 올바르지 않습니다.",
    )?;
    let source_paths = sources
        .iter()
        .map(|source| {
            c_string(
                source
                    .path
                    .to_str()
                    .ok_or("입력 경로를 UTF-8로 처리할 수 없습니다.")?,
                "입력 경로가 올바르지 않습니다.",
            )
        })
        .collect::<Result<Vec<_>, _>>()?;
    let archive_paths = sources
        .iter()
        .map(|source| c_string(&source.archive_path, "압축 항목 이름이 올바르지 않습니다."))
        .collect::<Result<Vec<_>, _>>()?;
    let inputs = sources
        .iter()
        .enumerate()
        .map(|(index, source)| {
            let modified_seconds = source
                .metadata
                .as_ref()
                .and_then(|metadata| metadata.modified().ok())
                .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
                .map_or(0, |value| value.as_secs().min(i64::MAX as u64) as i64);
            SdkInput {
                source_path: source_paths[index].as_ptr(),
                archive_path: archive_paths[index].as_ptr(),
                size: source.metadata.as_ref().map_or(0, Metadata::len),
                modified_seconds,
                is_directory: c_int::from(source.directory),
            }
        })
        .collect::<Vec<_>>();
    let password = password
        .filter(|value| !value.is_empty())
        .map(|value| c_string(value, "암호에 지원하지 않는 문자가 포함되어 있습니다."))
        .transpose()?;

    let mut context = SdkProgressContext {
        cancelled,
        on_progress,
    };
    let input_count = u32::try_from(inputs.len()).map_err(|_| "압축 항목 수가 너무 많습니다.")?;
    let mut timings = diagnostics
        .as_ref()
        .map(|_| vec![SdkFileTiming::default(); inputs.len()]);
    let sdk_started_at = Instant::now();
    let status = unsafe {
        silk_7zip_create_archive(
            format.sdk_id(),
            output_path.as_ptr(),
            inputs.as_ptr(),
            input_count,
            compression_level as u32,
            password
                .as_ref()
                .map_or(std::ptr::null(), |value| value.as_ptr()),
            total_bytes,
            Some(sdk_progress::<F>),
            (&mut context as *mut SdkProgressContext<'_, F>).cast(),
            timings.as_mut().map_or(std::ptr::null_mut(), Vec::as_mut_ptr),
        )
    };
    if let (Some(diagnostics), Some(timings)) = (diagnostics, timings) {
        diagnostics.sdk_started_at = Some(sdk_started_at);
        for (index, (input, timing)) in inputs.iter().zip(timings).enumerate() {
            if input.is_directory != 0 {
                diagnostics.folders += 1;
                continue;
            }
            diagnostics.files += 1;
            diagnostics.empty_files += usize::from(input.size == 0);
            if timing.opened_us != 0 {
                diagnostics.timings.push(ZipFileTiming {
                    index: index + 1,
                    size: input.size,
                    opened_us: timing.opened_us,
                    released_us: (timing.released_us != 0).then_some(timing.released_us),
                });
            }
        }
    }
    if status != 0 {
        return Err(if cancelled.load(Ordering::Relaxed) {
            "압축 작업이 취소되었습니다.".into()
        } else {
            format!(
                "7-Zip SDK에서 {} 생성에 실패했습니다 (HRESULT 0x{:08X}).",
                format.label(),
                status as u32
            )
        });
    }
    if cancelled.load(Ordering::Relaxed) {
        return Err("압축 작업이 취소되었습니다.".into());
    }
    for source in sources.iter().filter(|source| !source.directory) {
        if fs::metadata(&source.path)
            .map_err(|error| error.to_string())?
            .len()
            != source.metadata.as_ref().map_or(0, Metadata::len)
        {
            return Err(format!(
                "압축 중 파일 크기가 변경되었습니다: {}",
                source.path.display()
            ));
        }
    }
    Ok(())
}

fn write_split_zip<F: FnMut(CreateProgress)>(
    sources: Vec<SourceEntry>,
    output_path: &Path,
    compression_level: u8,
    password: Option<&str>,
    split_size: u64,
    total_bytes: u64,
    cancelled: &Arc<AtomicBool>,
    mut on_progress: F,
    diagnostics: Option<&mut ZipDiagnostics>,
) -> Result<CreateResult, String> {
    let stage = temporary_directory(output_path)?;
    let staged_zip = stage.0.join(format!(
        "source-{}.zip",
        TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    create_with_7zip_sdk(
        ArchiveFormat::Zip,
        &sources,
        &staged_zip,
        compression_level,
        password,
        total_bytes,
        cancelled,
        &mut on_progress,
        diagnostics,
    )?;
    for source in sources.iter().filter(|source| !source.directory) {
        if fs::metadata(&source.path)
            .map_err(|error| error.to_string())?
            .len()
            != source.metadata.as_ref().map_or(0, Metadata::len)
        {
            return Err(format!(
                "압축 중 파일 크기가 변경되었습니다: {}",
                source.path.display()
            ));
        }
    }
    if cancelled.load(Ordering::Relaxed) {
        return Err("압축 작업이 취소되었습니다.".into());
    }
    on_progress(CreateProgress {
        phase: "finalizing".into(),
        completed_bytes: total_bytes,
        total_bytes,
        completed_entries: sources.len(),
        total_entries: sources.len(),
    });
    convert_zip_to_pkware_split(&staged_zip, &stage.0, output_path, split_size, cancelled)?;
    let _ = fs::remove_file(staged_zip);
    let size = commit_split_outputs(&stage.0, output_path)?;
    Ok(CreateResult {
        path: output_path.to_string_lossy().into_owned(),
        entries: sources.len(),
        size,
    })
}

/// Existing `name` and `name.NNN` files next to a 7z output.
fn seven_zip_volume_targets(output: &Path) -> Result<Vec<PathBuf>, String> {
    let parent = output
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let output_name = output
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("저장 파일 이름을 UTF-8로 처리할 수 없습니다.")?
        .to_lowercase();
    let mut targets = Vec::new();
    for item in fs::read_dir(parent).map_err(|error| error.to_string())? {
        let path = item.map_err(|error| error.to_string())?.path();
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        let lower = name.to_lowercase();
        let is_volume = lower.strip_prefix(&output_name).is_some_and(|rest| {
            rest.is_empty()
                || rest.strip_prefix('.').is_some_and(|number| {
                    !number.is_empty() && number.bytes().all(|byte| byte.is_ascii_digit())
                })
        });
        if is_volume {
            if !path.is_file() {
                return Err(format!(
                    "분할 압축 저장 경로에 파일이 아닌 항목이 있습니다: {}",
                    path.display()
                ));
            }
            targets.push(path);
        }
    }
    Ok(targets)
}

/// Split `archive` into `<output name>.001`, `.002`, ... inside `stage`.
fn split_file_into_volumes(
    archive: &Path,
    stage: &Path,
    output_name: &str,
    split_size: u64,
    cancelled: &AtomicBool,
) -> Result<Vec<PathBuf>, String> {
    use std::io::{Read, Write};
    let mut input = fs::File::open(archive).map_err(|error| error.to_string())?;
    let mut buffer = vec![0u8; 1024 * 1024];
    let mut volumes = Vec::new();
    loop {
        let number = volumes.len() + 1;
        if number > 9999 {
            return Err("분할 파일이 너무 많습니다. 분할 크기를 늘려 주세요.".into());
        }
        let path = stage.join(format!("{output_name}.{number:03}"));
        let mut output = fs::File::create(&path).map_err(|error| error.to_string())?;
        volumes.push(path);
        let mut written = 0u64;
        while written < split_size {
            if cancelled.load(Ordering::Relaxed) {
                return Err("압축 작업이 취소되었습니다.".into());
            }
            let want = (split_size - written).min(buffer.len() as u64) as usize;
            let read = input.read(&mut buffer[..want]).map_err(|error| error.to_string())?;
            if read == 0 {
                break;
            }
            output.write_all(&buffer[..read]).map_err(|error| error.to_string())?;
            written += read as u64;
        }
        output.flush().map_err(|error| error.to_string())?;
        if written < split_size {
            if written == 0 && volumes.len() > 1 {
                let empty = volumes.pop().unwrap();
                let _ = fs::remove_file(empty);
            }
            return Ok(volumes);
        }
    }
}

fn write_split_seven_zip<F: FnMut(CreateProgress)>(
    sources: Vec<SourceEntry>,
    output_path: &Path,
    compression_level: u8,
    password: Option<&str>,
    split_size: u64,
    total_bytes: u64,
    cancelled: &Arc<AtomicBool>,
    mut on_progress: F,
) -> Result<CreateResult, String> {
    let output_name = output_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("저장 파일 이름을 UTF-8로 처리할 수 없습니다.")?
        .to_string();
    let stage = temporary_directory(output_path)?;
    let staged = stage.0.join(format!(
        "source-{}.7z",
        TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    create_with_7zip_sdk(
        ArchiveFormat::SevenZip,
        &sources,
        &staged,
        compression_level,
        password,
        total_bytes,
        cancelled,
        &mut on_progress,
        None,
    )?;
    for source in sources.iter().filter(|source| !source.directory) {
        if fs::metadata(&source.path)
            .map_err(|error| error.to_string())?
            .len()
            != source.metadata.as_ref().map_or(0, Metadata::len)
        {
            return Err(format!(
                "압축 중 파일 크기가 변경되었습니다: {}",
                source.path.display()
            ));
        }
    }
    on_progress(CreateProgress {
        phase: "finalizing".into(),
        completed_bytes: total_bytes,
        total_bytes,
        completed_entries: sources.len(),
        total_entries: sources.len(),
    });
    let volumes = split_file_into_volumes(&staged, &stage.0, &output_name, split_size, cancelled)?;
    let _ = fs::remove_file(&staged);
    let total_size = volumes
        .iter()
        .try_fold(0u64, |total, path| total.checked_add(fs::metadata(path).ok()?.len()))
        .ok_or("분할 압축 파일 크기를 계산하지 못했습니다.")?;

    let parent = output_path
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let backup = stage.0.join(".previous-output");
    fs::create_dir(&backup).map_err(|error| error.to_string())?;
    let mut backed_up = Vec::<(PathBuf, PathBuf)>::new();
    let restore = |backed_up: &[(PathBuf, PathBuf)]| {
        for (original, saved) in backed_up.iter().rev() {
            let _ = fs::rename(saved, original);
        }
    };
    for target in seven_zip_volume_targets(output_path)? {
        let backup_path = backup.join(target.file_name().ok_or("기존 파일 이름을 읽지 못했습니다.")?);
        if let Err(error) = fs::rename(&target, &backup_path) {
            restore(&backed_up);
            return Err(format!("기존 분할 압축 파일을 보관하지 못했습니다: {error}"));
        }
        backed_up.push((target, backup_path));
    }
    let mut installed = Vec::<(PathBuf, PathBuf)>::new();
    for volume in volumes {
        let destination = parent.join(volume.file_name().ok_or("분할 파일 이름을 읽지 못했습니다.")?);
        if let Err(error) = fs::rename(&volume, &destination) {
            for (original, destination) in installed.iter().rev() {
                let _ = fs::rename(destination, original);
            }
            restore(&backed_up);
            return Err(format!("분할 압축 파일을 저장하지 못했습니다: {error}"));
        }
        installed.push((volume, destination));
    }
    Ok(CreateResult {
        path: parent.join(format!("{output_name}.001")).to_string_lossy().into_owned(),
        entries: sources.len(),
        size: total_size,
    })
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
    write_archive(
        ArchiveFormat::Zip,
        sources,
        output_path,
        compression_level,
        password,
        None,
        cancelled,
        on_progress,
        None,
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
    create_zip_entries_with_split(
        inputs,
        output_path,
        compression_level,
        password,
        None,
        cancelled,
        on_progress,
    )
}

pub fn create_zip_entries_with_split<F: FnMut(CreateProgress)>(
    inputs: &[CreateInput],
    output_path: &Path,
    compression_level: u8,
    password: Option<&str>,
    split_size: Option<u64>,
    cancelled: &Arc<AtomicBool>,
    on_progress: F,
) -> Result<CreateResult, String> {
    create_zip_entries_with_diagnostics(
        inputs, output_path, compression_level, password, split_size, cancelled, on_progress, None,
    )
}

pub fn create_zip_entries_with_diagnostics<F: FnMut(CreateProgress)>(
    inputs: &[CreateInput],
    output_path: &Path,
    compression_level: u8,
    password: Option<&str>,
    split_size: Option<u64>,
    cancelled: &Arc<AtomicBool>,
    on_progress: F,
    diagnostics: Option<&mut ZipDiagnostics>,
) -> Result<CreateResult, String> {
    create_archive_entries(
        ArchiveFormat::Zip,
        inputs,
        output_path,
        compression_level,
        password,
        split_size,
        cancelled,
        on_progress,
        diagnostics,
    )
}

/// Create an archive of `format` from explicit entries. TAR stores data
/// uncompressed and supports neither passwords nor splitting.
pub fn create_archive_entries<F: FnMut(CreateProgress)>(
    format: ArchiveFormat,
    inputs: &[CreateInput],
    output_path: &Path,
    compression_level: u8,
    password: Option<&str>,
    split_size: Option<u64>,
    cancelled: &Arc<AtomicBool>,
    on_progress: F,
    mut diagnostics: Option<&mut ZipDiagnostics>,
) -> Result<CreateResult, String> {
    crate::locale::ensure_utf8();
    if let Some(diagnostics) = diagnostics.as_mut() {
        **diagnostics = ZipDiagnostics::default();
    }
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
    write_archive(
        format,
        sources,
        output_path,
        compression_level,
        password,
        split_size,
        cancelled,
        on_progress,
        diagnostics,
    )
}

fn output_extension_matches(format: ArchiveFormat, output_path: &Path) -> bool {
    let name = output_path
        .file_name()
        .map(|value| value.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    match format {
        ArchiveFormat::Tgz => name.ends_with(".tgz") || name.ends_with(".tar.gz"),
        _ => name.ends_with(&format!(".{}", format.extension())),
    }
}

fn gzip_file<F: FnMut(CreateProgress)>(
    input: &Path,
    output: &Path,
    name: Option<&str>,
    modified_seconds: i64,
    level: u8,
    total_bytes: u64,
    cancelled: &AtomicBool,
    on_progress: &mut F,
) -> Result<(), String> {
    let input_path = c_string(
        input.to_str().ok_or("입력 경로를 UTF-8로 처리할 수 없습니다.")?,
        "입력 경로가 올바르지 않습니다.",
    )?;
    let output_path = c_string(
        output.to_str().ok_or("저장 경로를 UTF-8로 처리할 수 없습니다.")?,
        "저장 경로가 올바르지 않습니다.",
    )?;
    let name = name
        .map(|value| c_string(value, "압축 항목 이름이 올바르지 않습니다."))
        .transpose()?;
    let mut context = SdkProgressContext {
        cancelled,
        on_progress,
    };
    let status = unsafe {
        silk_7zip_gzip_file(
            input_path.as_ptr(),
            output_path.as_ptr(),
            name.as_ref().map_or(std::ptr::null(), |value| value.as_ptr()),
            modified_seconds,
            level as u32,
            total_bytes,
            Some(sdk_progress::<F>),
            (&mut context as *mut SdkProgressContext<'_, F>).cast(),
        )
    };
    if cancelled.load(Ordering::Relaxed) {
        return Err("압축 작업이 취소되었습니다.".into());
    }
    if status != 0 {
        return Err(format!("GZ 압축에 실패했습니다 (HRESULT 0x{:08X}).", status as u32));
    }
    Ok(())
}

fn write_gzip<F: FnMut(CreateProgress)>(
    format: ArchiveFormat,
    sources: Vec<SourceEntry>,
    output_path: &Path,
    compression_level: u8,
    total_bytes: u64,
    cancelled: &Arc<AtomicBool>,
    mut on_progress: F,
) -> Result<CreateResult, String> {
    let temporary = temporary_path(output_path)?;
    let cleanup = TemporaryOutput(temporary.clone());
    let entries = sources.len();
    if format == ArchiveFormat::Gz {
        let source = &sources[0];
        let name = source.archive_path.rsplit('/').next().unwrap_or(&source.archive_path);
        let modified_seconds = source
            .metadata
            .as_ref()
            .and_then(|metadata| metadata.modified().ok())
            .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
            .map_or(0, |value| value.as_secs().min(i64::MAX as u64) as i64);
        gzip_file(
            &source.path,
            &temporary,
            Some(name),
            modified_seconds,
            compression_level,
            total_bytes,
            cancelled,
            &mut on_progress,
        )?;
        if fs::metadata(&source.path).map_err(|error| error.to_string())?.len()
            != source.metadata.as_ref().map_or(0, Metadata::len)
        {
            return Err(format!(
                "압축 중 파일 크기가 변경되었습니다: {}",
                source.path.display()
            ));
        }
    } else {
        let stage = temporary_directory(output_path)?;
        let tar = stage.0.join("source.tar");
        // Reading the sources into the tar stage is the cheap first fifth of the work.
        let tar_share = total_bytes / 5;
        create_with_7zip_sdk(
            ArchiveFormat::Tar,
            &sources,
            &tar,
            compression_level,
            None,
            total_bytes,
            cancelled,
            &mut |progress: CreateProgress| {
                on_progress(CreateProgress {
                    completed_bytes: progress.completed_bytes / 5,
                    ..progress
                })
            },
            None,
        )?;
        let tar_size = fs::metadata(&tar).map_err(|error| error.to_string())?.len();
        gzip_file(
            &tar,
            &temporary,
            None,
            0,
            compression_level,
            tar_size,
            cancelled,
            &mut |progress: CreateProgress| {
                let compressed = (u128::from(progress.completed_bytes)
                    * u128::from(total_bytes - tar_share)
                    / u128::from(progress.total_bytes.max(1))) as u64;
                on_progress(CreateProgress {
                    completed_bytes: tar_share + compressed,
                    total_bytes,
                    completed_entries: entries,
                    total_entries: entries,
                    ..progress
                })
            },
        )?;
    }
    on_progress(CreateProgress {
        phase: "finalizing".into(),
        completed_bytes: total_bytes,
        total_bytes,
        completed_entries: entries,
        total_entries: entries,
    });
    replace_output(&temporary, output_path)?;
    drop(cleanup);
    let size = fs::metadata(output_path)
        .map_err(|error| error.to_string())?
        .len();
    Ok(CreateResult {
        path: output_path.to_string_lossy().into_owned(),
        entries,
        size,
    })
}

fn write_archive<F: FnMut(CreateProgress)>(
    format: ArchiveFormat,
    sources: Vec<SourceEntry>,
    output_path: &Path,
    compression_level: u8,
    password: Option<&str>,
    split_size: Option<u64>,
    cancelled: &Arc<AtomicBool>,
    mut on_progress: F,
    diagnostics: Option<&mut ZipDiagnostics>,
) -> Result<CreateResult, String> {
    if format != ArchiveFormat::Tar && !matches!(compression_level, 1 | 6 | 9) {
        return Err("지원하지 않는 압축 수준입니다.".into());
    }
    if !matches!(format, ArchiveFormat::Zip | ArchiveFormat::SevenZip)
        && password.is_some_and(|value| !value.is_empty())
    {
        return Err(format!("{} 형식은 암호를 지원하지 않습니다.", format.label()));
    }
    if !matches!(format, ArchiveFormat::Zip | ArchiveFormat::SevenZip) {
        if split_size.is_some() {
            return Err(format!("{} 형식은 분할 압축을 지원하지 않습니다.", format.label()));
        }
    }
    if split_size.is_some_and(|size| size < 64 * 1024 || size > i64::MAX as u64) {
        return Err("분할 크기는 64KB 이상이어야 합니다.".into());
    }
    if !output_extension_matches(format, output_path) {
        return Err(format!(
            "{} 파일의 확장자는 .{}이어야 합니다.",
            format.label(),
            format.extension()
        ));
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
    if matches!(format, ArchiveFormat::Gz | ArchiveFormat::Xz)
        && (sources.len() != 1 || sources[0].directory)
    {
        return Err(format!(
            "{}는 파일 하나만 압축할 수 있습니다. 여러 파일이나 폴더는 TGZ 또는 TAR을 사용하세요.",
            format.label()
        ));
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
    if split_size.is_some() {
        let targets = if format == ArchiveFormat::SevenZip {
            seven_zip_volume_targets(output_path)?
        } else {
            existing_split_targets(output_path)?
        };
        for target in targets {
            let target_canonical = fs::canonicalize(&target).map_err(|error| error.to_string())?;
            if sources
                .iter()
                .filter(|source| !source.directory)
                .any(|source| {
                    fs::canonicalize(&source.path).ok().as_ref() == Some(&target_canonical)
                })
            {
                return Err(format!(
                    "분할 압축 파일이 입력 파일과 같은 경로입니다: {}",
                    target.display()
                ));
            }
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

    if matches!(format, ArchiveFormat::Gz | ArchiveFormat::Tgz) {
        return write_gzip(
            format,
            sources,
            output_path,
            compression_level,
            total_bytes,
            cancelled,
            on_progress,
        );
    }

    if let (Some(split_size), ArchiveFormat::SevenZip) = (split_size, format) {
        return write_split_seven_zip(
            sources,
            output_path,
            compression_level,
            password,
            split_size,
            total_bytes,
            cancelled,
            on_progress,
        );
    }

    if let Some(split_size) = split_size {
        return write_split_zip(
            sources,
            output_path,
            compression_level,
            password,
            split_size,
            total_bytes,
            cancelled,
            on_progress,
            diagnostics,
        );
    }

    let temporary = temporary_path(output_path)?;
    let cleanup = TemporaryOutput(temporary.clone());
    if cancelled.load(Ordering::Relaxed) {
        return Err("압축 작업이 취소되었습니다.".into());
    }
    create_with_7zip_sdk(
        format,
        &sources,
        &temporary,
        compression_level,
        password,
        total_bytes,
        cancelled,
        &mut on_progress,
        diagnostics,
    )?;
    on_progress(CreateProgress {
        phase: "finalizing".into(),
        completed_bytes: total_bytes,
        total_bytes,
        completed_entries: sources.len(),
        total_entries: sources.len(),
    });
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
