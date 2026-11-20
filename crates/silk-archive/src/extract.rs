//! Extraction backed by the 7-Zip SDK. Format detection, numbered split volumes
//! (`.001`) and encrypted archives are handled by the SDK adapter.
use crate::create::{c_string, sdk_progress, CreateProgress, SdkProgressContext};
use serde::Serialize;
use std::{
    ffi::{c_char, c_int, c_void, CString},
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, AtomicU64, Ordering},
};

#[repr(C)]
struct SdkExtractResult {
    extracted: u32,
    skipped: u32,
    failed: u32,
    first_error: i32,
    need_password: i32,
    format: [c_char; 32],
    message: [c_char; 256],
}

type SdkProgressCallback = unsafe extern "C" fn(u64, u64, u32, u32, *mut c_void) -> c_int;

unsafe extern "C" {
    fn silk_7zip_extract(
        archive_path: *const c_char,
        output_dir: *const c_char,
        password: *const c_char,
        overwrite: c_int,
        test_only: c_int,
        only: *const *const c_char,
        only_count: u32,
        progress: Option<SdkProgressCallback>,
        progress_context: *mut c_void,
        result: *mut SdkExtractResult,
    ) -> c_int;
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractResult {
    pub output_dir: String,
    pub format: String,
    pub extracted: usize,
    pub skipped: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestResult {
    pub format: String,
    pub tested: usize,
}

/// Decodes every entry without writing anything and reports whether the archive is intact.
/// Errors name the problem (wrong password, damaged data, missing volume).
pub fn test_archive<F: FnMut(CreateProgress)>(
    archive: &Path,
    password: Option<&str>,
    cancelled: &AtomicBool,
    mut on_progress: F,
) -> Result<TestResult, String> {
    crate::locale::ensure_utf8();
    if !archive.is_file() {
        return Err("압축 파일을 찾을 수 없습니다.".into());
    }
    on_progress(CreateProgress {
        phase: "preparing".into(),
        completed_bytes: 0,
        total_bytes: 0,
        completed_entries: 0,
        total_entries: 0,
    });
    let (format, tested, _) =
        extract_once(archive, Path::new(""), password, false, true, &[], cancelled, &mut on_progress)?;
    Ok(TestResult { format, tested: tested as usize })
}

static EXTRACT_COUNTER: AtomicU64 = AtomicU64::new(0);

struct StageDirectory(PathBuf);

impl Drop for StageDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn text(buffer: &[c_char]) -> String {
    let bytes: Vec<u8> = buffer.iter().take_while(|byte| **byte != 0).map(|byte| *byte as u8).collect();
    String::from_utf8_lossy(&bytes).into_owned()
}

fn extract_once<F: FnMut(CreateProgress)>(
    archive: &Path,
    output_dir: &Path,
    password: Option<&str>,
    overwrite: bool,
    test_only: bool,
    only: &[CString],
    cancelled: &AtomicBool,
    on_progress: &mut F,
) -> Result<(String, u32, u32), String> {
    let archive_c = c_string(
        archive.to_str().ok_or("압축 파일 경로를 UTF-8로 처리할 수 없습니다.")?,
        "압축 파일 경로가 올바르지 않습니다.",
    )?;
    let output_c = c_string(
        output_dir.to_str().ok_or("저장 경로를 UTF-8로 처리할 수 없습니다.")?,
        "저장 경로가 올바르지 않습니다.",
    )?;
    let password_c = password
        .filter(|value| !value.is_empty())
        .map(|value| c_string(value, "암호가 올바르지 않습니다."))
        .transpose()?;
    let only_pointers: Vec<*const c_char> = only.iter().map(|value| value.as_ptr()).collect();
    let mut context = SdkProgressContext { cancelled, on_progress };
    let mut result = SdkExtractResult {
        extracted: 0,
        skipped: 0,
        failed: 0,
        first_error: 0,
        need_password: 0,
        format: [0; 32],
        message: [0; 256],
    };
    let status = unsafe {
        silk_7zip_extract(
            archive_c.as_ptr(),
            output_c.as_ptr(),
            password_c.as_ref().map_or(std::ptr::null(), |value| value.as_ptr()),
            c_int::from(overwrite),
            c_int::from(test_only),
            if only_pointers.is_empty() { std::ptr::null() } else { only_pointers.as_ptr() },
            only_pointers.len() as u32,
            Some(sdk_progress::<F>),
            (&mut context as *mut SdkProgressContext<'_, F>).cast(),
            &mut result,
        )
    };
    if cancelled.load(Ordering::Relaxed) {
        return Err("압축 풀기가 취소되었습니다.".into());
    }
    if result.need_password != 0 {
        return Err(if password.is_some_and(|value| !value.is_empty()) {
            "암호가 올바르지 않습니다.".into()
        } else {
            "암호가 필요한 압축 파일입니다.".into()
        });
    }
    if text(&result.message) == "no_match" {
        return Err("선택한 항목을 압축 파일에서 찾지 못했습니다.".into());
    }
    if status == 1 {
        return Err("지원하지 않는 형식이거나 손상된 압축 파일입니다.".into());
    }
    if status != 0 {
        return Err(format!("압축 풀기에 실패했습니다 (HRESULT 0x{:08X}).", status as u32));
    }
    if result.failed > 0 {
        let reason = match result.first_error {
            1 => "지원하지 않는 압축 방식입니다.",
            2 | 5 | 6 => "압축 파일이 손상되었습니다.",
            3 | 9 => "암호가 올바르지 않거나 파일이 손상되었습니다.",
            4 => "압축 파일의 일부 조각이 없습니다.",
            _ => match text(&result.message).as_str() {
                "unsafe_path" => "압축 파일에 저장 폴더 밖을 가리키는 안전하지 않은 경로가 있습니다.",
                "create_failed" => "파일을 만들지 못했습니다. 경로와 권한을 확인하세요.",
                _ => "",
            },
        };
        let reason = if reason.is_empty() { "일부 항목을 처리하지 못했습니다." } else { reason };
        return Err(if test_only {
            format!("{}개 항목에 문제가 있습니다. {reason}", result.failed)
        } else {
            format!("{}개 항목을 풀지 못했습니다. {reason}", result.failed)
        });
    }
    Ok((text(&result.format), result.extracted, result.skipped))
}

/// Single-stream compressors whose payload is usually a tar.
fn is_stream_compressor(format: &str) -> bool {
    matches!(format.to_ascii_lowercase().as_str(), "gzip" | "bzip2" | "xz" | "lzma" | "zstd" | "z")
}

/// Extract every entry of `archive` below `output_dir`. Existing files are kept
/// unless `overwrite` is set. Entries that would leave `output_dir` and symlinks
/// are never written.
pub fn extract_archive<F: FnMut(CreateProgress)>(
    archive: &Path,
    output_dir: &Path,
    password: Option<&str>,
    overwrite: bool,
    cancelled: &AtomicBool,
    on_progress: F,
) -> Result<ExtractResult, String> {
    extract_entries(archive, output_dir, password, overwrite, &[], cancelled, on_progress)
}

/// Like [`extract_archive`] but only the listed archive paths (folders include everything
/// below them) are written, each below `output_dir` without its parent folders.
/// An empty `only` extracts everything.
pub fn extract_entries<F: FnMut(CreateProgress)>(
    archive: &Path,
    output_dir: &Path,
    password: Option<&str>,
    overwrite: bool,
    only: &[String],
    cancelled: &AtomicBool,
    mut on_progress: F,
) -> Result<ExtractResult, String> {
    use unicode_normalization::UnicodeNormalization;
    // The listing shows NFC names, while an archive may store NFD; match either form.
    let mut variants: Vec<String> = Vec::new();
    for path in only {
        for form in [path.clone(), path.nfc().collect(), path.nfd().collect()] {
            if !form.is_empty() && !variants.contains(&form) {
                variants.push(form);
            }
        }
    }
    let only = variants
        .iter()
        .map(|path| c_string(path, "선택한 항목 경로가 올바르지 않습니다."))
        .collect::<Result<Vec<_>, _>>()?;
    crate::locale::ensure_utf8();
    if !archive.is_file() {
        return Err("압축 파일을 찾을 수 없습니다.".into());
    }
    if output_dir.exists() && !output_dir.is_dir() {
        return Err("저장 위치에 같은 이름의 파일이 있습니다.".into());
    }
    fs::create_dir_all(output_dir).map_err(|error| format!("저장 폴더를 만들지 못했습니다: {error}"))?;
    let display_dir = output_dir.to_string_lossy().into_owned();
    let output_dir = fs::canonicalize(output_dir).map_err(|error| error.to_string())?;
    let report = |on_progress: &mut F, phase: &str| {
        on_progress(CreateProgress {
            phase: phase.into(),
            completed_bytes: 0,
            total_bytes: 0,
            completed_entries: 0,
            total_entries: 0,
        })
    };
    report(&mut on_progress, "preparing");

    // Only single-stream compressors can wrap a tar, so everything else is written
    // straight into place. (Moving thousands of staged files took tens of seconds.)
    let name = archive.file_name().map(|name| name.to_string_lossy().to_lowercase()).unwrap_or_default();
    let may_wrap_tar = [".gz", ".tgz", ".bz2", ".tbz", ".tbz2", ".xz", ".txz", ".lzma", ".zst", ".tzst", ".z", ".taz"]
        .iter()
        .any(|suffix| name.ends_with(suffix));
    if !may_wrap_tar {
        let (format, extracted, skipped) =
            extract_once(archive, &output_dir, password, overwrite, false, &only, cancelled, &mut on_progress)?;
        on_progress(CreateProgress {
            phase: "finalizing".into(),
            completed_bytes: 1,
            total_bytes: 1,
            completed_entries: extracted as usize,
            total_entries: (extracted + skipped) as usize,
        });
        return Ok(ExtractResult {
            output_dir: display_dir,
            format,
            extracted: extracted as usize,
            skipped: skipped as usize,
        });
    }

    // First pass into a stage folder when the archive may be a compressed tar.
    let stage = StageDirectory(output_dir.join(format!(
        ".silk-zip-extract-{}-{}",
        std::process::id(),
        EXTRACT_COUNTER.fetch_add(1, Ordering::Relaxed)
    )));
    fs::create_dir(&stage.0).map_err(|error| error.to_string())?;
    let (format, extracted, skipped) =
        extract_once(archive, &stage.0, password, true, false, &[], cancelled, &mut on_progress)?;

    let staged: Vec<PathBuf> = fs::read_dir(&stage.0)
        .map_err(|error| error.to_string())?
        .filter_map(|item| item.ok().map(|item| item.path()))
        .collect();
    if is_stream_compressor(&format) && staged.len() == 1 && staged[0].is_file() {
        let name = staged[0].file_name().unwrap().to_string_lossy().to_lowercase();
        if name.ends_with(".tar") || looks_like_tar(&staged[0]) {
            let (_, extracted, skipped) =
                extract_once(&staged[0], &output_dir, None, overwrite, false, &only, cancelled, &mut on_progress)?;
            return Ok(ExtractResult {
                output_dir: display_dir,
                format: format!("{format}+tar"),
                extracted: extracted as usize,
                skipped: skipped as usize,
            });
        }
    }

    // Plain archive: move the staged tree into place without following symlinks.
    let (moved, kept) = move_tree(&stage.0, &output_dir, overwrite)?;
    let _ = (extracted, skipped);
    on_progress(CreateProgress {
        phase: "finalizing".into(),
        completed_bytes: 1,
        total_bytes: 1,
        completed_entries: moved,
        total_entries: moved + kept,
    });
    Ok(ExtractResult {
        output_dir: display_dir,
        format,
        extracted: moved,
        skipped: kept + skipped as usize,
    })
}

fn move_tree(from: &Path, to: &Path, overwrite: bool) -> Result<(usize, usize), String> {
    let mut moved = 0;
    let mut kept = 0;
    for item in fs::read_dir(from).map_err(|error| error.to_string())? {
        let item = item.map_err(|error| error.to_string())?;
        let source = item.path();
        let target = to.join(item.file_name());
        let kind = item.file_type().map_err(|error| error.to_string())?;
        if kind.is_dir() {
            fs::create_dir_all(&target).map_err(|error| error.to_string())?;
            let (inner_moved, inner_kept) = move_tree(&source, &target, overwrite)?;
            moved += inner_moved;
            kept += inner_kept;
        } else if kind.is_file() {
            if target.exists() {
                if !overwrite {
                    kept += 1;
                    continue;
                }
                if target.is_dir() {
                    return Err(format!("같은 이름의 폴더가 있습니다: {}", target.display()));
                }
                fs::remove_file(&target).map_err(|error| error.to_string())?;
            }
            fs::rename(&source, &target).map_err(|error| error.to_string())?;
            moved += 1;
        }
    }
    Ok((moved, kept))
}

/// A gzip written without a name leaves no ".tar" hint, so check the tar magic.
fn looks_like_tar(path: &Path) -> bool {
    use std::io::Read;
    let mut header = [0u8; 512];
    fs::File::open(path)
        .and_then(|mut file| file.read_exact(&mut header))
        .is_ok()
        && &header[257..262] == b"ustar"
}
