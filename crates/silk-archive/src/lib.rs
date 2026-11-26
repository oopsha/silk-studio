//! Shared, UI-independent archive inspection backed by libarchive.
pub mod create;
pub mod extract;
mod locale;

use serde::Serialize;
use unicode_normalization::UnicodeNormalization;
use std::ffi::CString;
use std::{
    ffi::{c_char, c_int, c_void, CStr},
    path::Path,
};

#[cfg(any(windows, target_os = "macos"))]
type ArchiveMode = u16;
#[cfg(not(any(windows, target_os = "macos")))]
type ArchiveMode = u32;

// Only opaque pointers cross this small C ABI boundary; ownership stays in Reader.
unsafe extern "C" {
    fn archive_version_string() -> *const c_char;
    fn archive_read_new() -> *mut c_void;
    fn archive_read_support_filter_all(a: *mut c_void) -> c_int;
    fn archive_read_support_format_all(a: *mut c_void) -> c_int;
    #[cfg(not(windows))]
    fn archive_read_open_filename(a: *mut c_void, path: *const c_char, block: usize) -> c_int;
    #[cfg(windows)]
    fn archive_read_open_filename_w(a: *mut c_void, path: *const u16, block: usize) -> c_int;
    fn archive_read_next_header(a: *mut c_void, entry: *mut *mut c_void) -> c_int;
    fn archive_read_data_skip(a: *mut c_void) -> c_int;
    fn archive_read_free(a: *mut c_void) -> c_int;
    fn archive_error_string(a: *mut c_void) -> *const c_char;
    fn archive_format_name(a: *mut c_void) -> *const c_char;
    fn archive_entry_pathname_utf8(e: *mut c_void) -> *const c_char;
    fn archive_entry_size(e: *mut c_void) -> i64;
    fn archive_entry_size_is_set(e: *mut c_void) -> c_int;
    fn archive_entry_filetype(e: *mut c_void) -> ArchiveMode;
    fn archive_entry_is_encrypted(e: *mut c_void) -> c_int;
    fn silk_7zip_list_details(
        archive_path: *const c_char,
        callback: Option<DetailCallback>,
        context: *mut c_void,
    ) -> c_int;
    fn silk_7zip_list_split_zip(
        archive_path: *const c_char,
        entry_callback: Option<SplitZipEntryCallback>,
        entry_context: *mut c_void,
    ) -> c_int;
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveEntry {
    pub path: String,
    pub size: Option<u64>,
    pub directory: bool,
    pub encrypted: bool,
    /// Size inside the archive.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub packed_size: Option<u64>,
    /// Modification time, seconds since 1970-01-01 UTC.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub crc: Option<u32>,
    /// Compression method as reported by the format (e.g. "Deflate", "LZMA2:24").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    /// "ZipCrypto" or "AES-256" and so on, when the entry is encrypted.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub encryption: Option<String>,
    /// File attributes: Windows flags in the low bits, a Unix mode in the high 16 bits.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attributes: Option<u32>,
}

impl ArchiveEntry {
    fn basic(path: String, size: Option<u64>, directory: bool, encrypted: bool) -> Self {
        Self { path, size, directory, encrypted, packed_size: None, modified: None, crc: None, method: None, encryption: None, attributes: None }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveListing {
    pub path: String,
    pub format: String,
    pub engine: String,
    pub entries: Vec<ArchiveEntry>,
    pub warnings: Vec<String>,
}

pub use extract::{extract_archive, extract_entries, extract_entries_ask, ConflictAnswer, ConflictHandler, ConflictQuery, repair_archive, test_archive, update_archive, EntryChange, ExtractResult, RepairResult, TestResult, UpdateResult};
pub use create::{
    create_archive_entries, create_zip, create_zip_entries, create_zip_entries_with_diagnostics,
    create_zip_entries_with_split, ArchiveFormat, CreateInput, CreateProgress, CreateResult, ZipDiagnostics,
    ZipFileTiming,
};

type SplitZipEntryCallback = unsafe extern "C" fn(
    name: *const c_char,
    size: u64,
    size_is_set: c_int,
    is_directory: c_int,
    is_encrypted: c_int,
    context: *mut c_void,
) -> c_int;

struct Reader(*mut c_void);
impl Drop for Reader {
    fn drop(&mut self) {
        unsafe {
            archive_read_free(self.0);
        }
    }
}

// Copy strings immediately: libarchive owns them and can invalidate them on next read.
unsafe fn string(pointer: *const c_char) -> Option<String> {
    if pointer.is_null() {
        None
    } else {
        Some(CStr::from_ptr(pointer).to_string_lossy().into_owned())
    }
}

impl Reader {
    fn error(&self) -> String {
        unsafe {
            string(archive_error_string(self.0))
                .unwrap_or_else(|| "압축 파일을 읽지 못했습니다.".into())
        }
    }
}

fn split_volume_exists(path: &Path) -> Result<bool, String> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let stem = path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .ok_or("압축 파일 이름을 읽지 못했습니다.")?;
    let expected = format!("{stem}.z01");
    for entry in std::fs::read_dir(parent).map_err(|error| error.to_string())? {
        let name = entry
            .map_err(|error| error.to_string())?
            .file_name()
            .to_string_lossy()
            .into_owned();
        if name.eq_ignore_ascii_case(&expected) {
            return Ok(true);
        }
    }
    Ok(false)
}

struct SplitZipListingContext {
    entries: Vec<ArchiveEntry>,
    name_bytes: usize,
    error: Option<String>,
}

unsafe extern "C" fn collect_split_zip_entry(
    name: *const c_char,
    size: u64,
    size_is_set: c_int,
    is_directory: c_int,
    is_encrypted: c_int,
    context: *mut c_void,
) -> c_int {
    let context = &mut *context.cast::<SplitZipListingContext>();
    if name.is_null() {
        context.error = Some("분할 ZIP 항목 이름을 읽지 못했습니다.".into());
        return 1;
    }
    let name = match CStr::from_ptr(name).to_str() {
        Ok(name) => name.to_owned(),
        Err(_) => {
            context.error = Some("분할 ZIP 파일 이름이 올바른 UTF-8이 아닙니다.".into());
            return 1;
        }
    };
    context.name_bytes = context.name_bytes.saturating_add(name.len());
    if context.entries.len() >= 100_000 || context.name_bytes > 16 * 1024 * 1024 {
        context.error = Some(
            "이 파일은 현재 목록 표시 한도(10만 항목 또는 이름 합계 16MB)를 초과합니다.".into(),
        );
        return 1;
    }
    context.entries.push(ArchiveEntry::basic(name, (size_is_set != 0).then_some(size), is_directory != 0, is_encrypted != 0));
    0
}

type DetailCallback = unsafe extern "C" fn(
    path: *const c_char,
    packed_size: u64,
    packed_set: c_int,
    modified: i64,
    modified_set: c_int,
    crc: u32,
    crc_set: c_int,
    method: *const c_char,
    attributes: u32,
    attributes_set: c_int,
    context: *mut c_void,
) -> c_int;

struct EntryDetail {
    packed_size: Option<u64>,
    modified: Option<i64>,
    crc: Option<u32>,
    method: Option<String>,
    attributes: Option<u32>,
}

/// Same spelling for a name read by libarchive and by the 7-Zip SDK.
fn detail_key(path: &str) -> String {
    let path = path.replace('\\', "/");
    path.trim_start_matches("./").trim_end_matches('/').nfc().collect()
}

unsafe extern "C" fn collect_detail(
    path: *const c_char,
    packed_size: u64,
    packed_set: c_int,
    modified: i64,
    modified_set: c_int,
    crc: u32,
    crc_set: c_int,
    method: *const c_char,
    attributes: u32,
    attributes_set: c_int,
    context: *mut c_void,
) -> c_int {
    let details = &mut *context.cast::<std::collections::HashMap<String, std::collections::VecDeque<EntryDetail>>>();
    let Some(path) = string(path) else { return 0 };
    let method = string(method).filter(|method| !method.is_empty());
    details.entry(detail_key(&path)).or_default().push_back(EntryDetail {
        packed_size: (packed_set != 0).then_some(packed_size),
        modified: (modified_set != 0).then_some(modified),
        crc: (crc_set != 0).then_some(crc),
        method,
        attributes: (attributes_set != 0).then_some(attributes),
    });
    0
}

/// The encryption method is part of the method text, e.g. "ZipCrypto Deflate" or "AES-256 LZMA2".
fn encryption_of(method: &str) -> Option<String> {
    method
        .split_whitespace()
        .find(|part| part.starts_with("ZipCrypto") || part.starts_with("AES") || part.starts_with("7zAES") || part.starts_with("RAR"))
        .map(|part| part.to_string())
}

/// Adds compressed size, time, CRC, method and attributes from the 7-Zip SDK. A format or file the SDK
/// cannot read keeps the entries as they are.
fn add_details(path: &Path, entries: &mut [ArchiveEntry]) {
    let Some(path_string) = path.to_str() else { return };
    let Ok(path_c) = CString::new(path_string) else { return };
    let mut details: std::collections::HashMap<String, std::collections::VecDeque<EntryDetail>> = std::collections::HashMap::new();
    let status = unsafe {
        silk_7zip_list_details(path_c.as_ptr(), Some(collect_detail), (&mut details as *mut std::collections::HashMap<String, std::collections::VecDeque<EntryDetail>>).cast())
    };
    if status != 0 && details.is_empty() {
        return;
    }
    for entry in entries {
        let Some(detail) = details.get_mut(&detail_key(&entry.path)).and_then(|queue| queue.pop_front()) else { continue };
        entry.packed_size = detail.packed_size;
        entry.modified = detail.modified;
        entry.crc = detail.crc;
        if entry.encrypted {
            entry.encryption = detail.method.as_deref().and_then(encryption_of);
        }
        entry.method = detail.method;
        entry.attributes = detail.attributes;
    }
}

fn list_split_zip(path: &Path) -> Result<ArchiveListing, String> {
    let path_string = path
        .to_str()
        .ok_or("압축 파일 경로를 UTF-8로 처리할 수 없습니다.")?;
    let path_c = CString::new(path_string).map_err(|_| "잘못된 압축 파일 경로입니다.")?;
    let mut context = SplitZipListingContext {
        entries: Vec::new(),
        name_bytes: 0,
        error: None,
    };
    let status = unsafe {
        silk_7zip_list_split_zip(
            path_c.as_ptr(),
            Some(collect_split_zip_entry),
            (&mut context as *mut SplitZipListingContext).cast(),
        )
    };
    if let Some(error) = context.error {
        return Err(error);
    }
    if status != 0 {
        return Err(format!("분할 ZIP을 열거나 목록을 읽지 못했습니다. 모든 .z01, .z02 등의 조각이 같은 폴더에 있는지 확인하세요. (오류 코드 0x{:08X})", status as u32));
    }
    Ok(ArchiveListing {
        path: path.to_string_lossy().into_owned(),
        format: "ZIP".into(),
        engine: "7-Zip SDK".into(),
        entries: context.entries,
        warnings: Vec::new(),
    })
}

/// Inspect headers without writing to disk. This is not an archive integrity test.
/// Reject excessive listings rather than silently returning a partial archive.
pub fn list_archive(path: &Path) -> Result<ArchiveListing, String> {
    locale::ensure_utf8();
    if !path.is_file() {
        return Err("압축 파일을 찾을 수 없습니다.".into());
    }
    if path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("zip"))
        && split_volume_exists(path)?
    {
        return list_split_zip(path);
    }
    let handle = unsafe { archive_read_new() };
    if handle.is_null() {
        return Err("압축 엔진을 초기화하지 못했습니다.".into());
    }
    let reader = Reader(handle);
    unsafe {
        archive_read_support_filter_all(reader.0);
        archive_read_support_format_all(reader.0);
    }
    #[cfg(windows)]
    let status = {
        use std::os::windows::ffi::OsStrExt;
        let name: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        unsafe { archive_read_open_filename_w(reader.0, name.as_ptr(), 65536) }
    };
    #[cfg(not(windows))]
    let status = {
        use std::os::unix::ffi::OsStrExt;
        let name =
            CString::new(path.as_os_str().as_bytes()).map_err(|_| "잘못된 파일 경로입니다.")?;
        unsafe { archive_read_open_filename(reader.0, name.as_ptr(), 65536) }
    };
    if status != 0 {
        return Err(reader.error());
    }
    let mut entries = Vec::new();
    let mut warnings = Vec::new();
    let mut name_bytes = 0usize;
    loop {
        let mut entry = std::ptr::null_mut();
        let status = unsafe { archive_read_next_header(reader.0, &mut entry) };
        if status == 1 {
            break;
        } // ARCHIVE_EOF
        if status < -20 || entry.is_null() {
            return Err(reader.error());
        }
        if status < 0 {
            if warnings.len() >= 100 {
                return Err("압축 파일에서 반복적인 읽기 경고가 발생했습니다.".into());
            }
            warnings.push(reader.error());
        }
        let name = unsafe { string(archive_entry_pathname_utf8(entry)) }
            .ok_or("파일 이름을 UTF-8로 읽지 못했습니다.")?;
        // macOS libarchive hands back decomposed (NFD) names; show them composed like everywhere else.
        let name: String = name.nfc().collect();
        name_bytes += name.len();
        if entries.len() >= 100_000 || name_bytes > 16 * 1024 * 1024 {
            return Err(
                "이 파일은 현재 목록 표시 한도(10만 항목 또는 이름 합계 16MB)를 초과합니다.".into(),
            );
        }
        let size = unsafe {
            (archive_entry_size_is_set(entry) != 0)
                .then(|| archive_entry_size(entry))
                .filter(|size| *size >= 0)
                .map(|size| size as u64)
        };
        entries.push(ArchiveEntry::basic(
            name,
            size,
            unsafe { archive_entry_filetype(entry) == 0o040000 },
            unsafe { archive_entry_is_encrypted(entry) > 0 },
        ));
        if unsafe { archive_read_data_skip(reader.0) } < 0 {
            return Err(reader.error());
        }
    }
    add_details(path, &mut entries);
    Ok(ArchiveListing {
        path: path.to_string_lossy().into_owned(),
        format: unsafe {
            string(archive_format_name(reader.0)).unwrap_or_else(|| "Unknown".into())
        },
        engine: unsafe { string(archive_version_string()).unwrap_or_else(|| "libarchive".into()) },
        entries,
        warnings,
    })
}
