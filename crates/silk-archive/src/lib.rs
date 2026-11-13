//! Shared, UI-independent archive inspection backed by libarchive.
use serde::Serialize;
#[cfg(not(windows))]
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
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveEntry {
    pub path: String,
    pub size: Option<u64>,
    pub directory: bool,
    pub encrypted: bool,
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

/// Inspect headers without writing to disk. This is not an archive integrity test.
/// Reject excessive listings rather than silently returning a partial archive.
pub fn list_archive(path: &Path) -> Result<ArchiveListing, String> {
    if !path.is_file() {
        return Err("압축 파일을 찾을 수 없습니다.".into());
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
        entries.push(ArchiveEntry {
            path: name,
            size,
            directory: unsafe { archive_entry_filetype(entry) == 0o040000 },
            encrypted: unsafe { archive_entry_is_encrypted(entry) > 0 },
        });
        if unsafe { archive_read_data_skip(reader.0) } < 0 {
            return Err(reader.error());
        }
    }
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
