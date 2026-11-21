//! File lists on the system clipboard (copy entries out of an archive, paste files into one).
use std::path::{Path, PathBuf};

fn root() -> PathBuf {
    std::env::temp_dir().join("silk-zip-clipboard")
}

/// Creates an empty folder for the next copy and removes what earlier copies left behind.
#[tauri::command]
pub fn clipboard_prepare_dir() -> Result<String, String> {
    let _ = std::fs::remove_dir_all(root());
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let dir = root().join(stamp.to_string());
    std::fs::create_dir_all(&dir).map_err(|error| format!("임시 폴더를 만들지 못했습니다: {error}"))?;
    Ok(dir.to_string_lossy().into_owned())
}

/// Puts every item of `dir` on the clipboard as a file list.
#[tauri::command]
pub fn clipboard_copy_dir(dir: String) -> Result<usize, String> {
    let dir = PathBuf::from(dir);
    if !dir.starts_with(root()) {
        return Err("복사할 수 없는 위치입니다.".into());
    }
    let mut paths: Vec<PathBuf> = std::fs::read_dir(&dir)
        .map_err(|error| format!("복사할 항목을 읽지 못했습니다: {error}"))?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .collect();
    paths.sort();
    if paths.is_empty() {
        return Err("복사할 항목이 없습니다.".into());
    }
    platform::write_files(&paths)?;
    Ok(paths.len())
}

/// Files currently on the clipboard (empty when it holds something else).
#[tauri::command]
pub fn clipboard_read_files() -> Result<Vec<String>, String> {
    Ok(platform::read_files()?.into_iter().filter(|path| Path::new(path).exists()).collect())
}

#[cfg(windows)]
mod platform {
    use std::ffi::OsStr;
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    use std::path::PathBuf;
    use windows_sys::Win32::Foundation::GlobalFree;
    use windows_sys::Win32::System::DataExchange::{CloseClipboard, EmptyClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard, SetClipboardData};
    use windows_sys::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE, GMEM_ZEROINIT};

    const CF_HDROP: u32 = 15;
    /// DROPFILES: pFiles(u32), pt(i32, i32), fNC(i32), fWide(i32).
    const HEADER: usize = 20;

    struct Clipboard;

    impl Clipboard {
        fn open() -> Result<Self, String> {
            // Another program may hold the clipboard for a moment.
            for _ in 0..10 {
                if unsafe { OpenClipboard(std::ptr::null_mut()) } != 0 {
                    return Ok(Self);
                }
                std::thread::sleep(std::time::Duration::from_millis(30));
            }
            Err("클립보드를 열지 못했습니다.".into())
        }
    }

    impl Drop for Clipboard {
        fn drop(&mut self) {
            unsafe { CloseClipboard() };
        }
    }

    pub fn write_files(paths: &[PathBuf]) -> Result<(), String> {
        let mut wide: Vec<u16> = Vec::new();
        for path in paths {
            wide.extend(OsStr::new(path).encode_wide());
            wide.push(0);
        }
        wide.push(0);
        let size = HEADER + wide.len() * 2;
        let _clipboard = Clipboard::open()?;
        unsafe {
            let handle = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, size);
            if handle.is_null() {
                return Err("클립보드 메모리를 확보하지 못했습니다.".into());
            }
            let pointer = GlobalLock(handle) as *mut u8;
            if pointer.is_null() {
                GlobalFree(handle);
                return Err("클립보드 메모리를 확보하지 못했습니다.".into());
            }
            std::ptr::copy_nonoverlapping((HEADER as u32).to_le_bytes().as_ptr(), pointer, 4);
            std::ptr::copy_nonoverlapping(1i32.to_le_bytes().as_ptr(), pointer.add(16), 4);
            std::ptr::copy_nonoverlapping(wide.as_ptr() as *const u8, pointer.add(HEADER), wide.len() * 2);
            GlobalUnlock(handle);
            EmptyClipboard();
            if SetClipboardData(CF_HDROP, handle).is_null() {
                GlobalFree(handle);
                return Err("클립보드에 복사하지 못했습니다.".into());
            }
        }
        Ok(())
    }

    pub fn read_files() -> Result<Vec<String>, String> {
        let _clipboard = Clipboard::open()?;
        unsafe {
            if IsClipboardFormatAvailable(CF_HDROP) == 0 {
                return Ok(Vec::new());
            }
            let handle = GetClipboardData(CF_HDROP);
            if handle.is_null() {
                return Ok(Vec::new());
            }
            let pointer = GlobalLock(handle) as *const u8;
            if pointer.is_null() {
                return Ok(Vec::new());
            }
            let total = GlobalSize(handle);
            let bytes = std::slice::from_raw_parts(pointer, total);
            let mut paths = Vec::new();
            if total > HEADER {
                let start = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as usize;
                let is_wide = i32::from_le_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]) != 0;
                if start <= total && is_wide {
                    let units: Vec<u16> = bytes[start..].chunks_exact(2).map(|pair| u16::from_le_bytes([pair[0], pair[1]])).collect();
                    for name in units.split(|unit| *unit == 0) {
                        if name.is_empty() {
                            break;
                        }
                        paths.push(std::ffi::OsString::from_wide(name).to_string_lossy().into_owned());
                    }
                }
            }
            GlobalUnlock(handle);
            Ok(paths)
        }
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use std::path::PathBuf;
    use std::process::Command;

    fn script(source: &str, argument: Option<&str>) -> Result<String, String> {
        let mut command = Command::new("osascript");
        command.args(["-l", "JavaScript", "-e", source]);
        if let Some(argument) = argument {
            command.arg(argument);
        }
        let output = command.output().map_err(|error| format!("클립보드를 사용하지 못했습니다: {error}"))?;
        if !output.status.success() {
            return Err(format!("클립보드를 사용하지 못했습니다: {}", String::from_utf8_lossy(&output.stderr).trim()));
        }
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }

    fn quote(path: &str) -> String {
        format!("\"{}\"", path.replace('\\', "\\\\").replace('"', "\\\""))
    }

    pub fn write_files(paths: &[PathBuf]) -> Result<(), String> {
        let list = paths.iter().map(|path| quote(&path.to_string_lossy())).collect::<Vec<_>>().join(",");
        script(
            "function run(argv) { ObjC.import('AppKit'); const paths = JSON.parse(argv[0]); const urls = paths.map((p) => $.NSURL.fileURLWithPath(p)); const pb = $.NSPasteboard.generalPasteboard; pb.clearContents; pb.writeObjects($(urls)); }",
            Some(&format!("[{list}]")),
        )
        .map(|_| ())
    }

    pub fn read_files() -> Result<Vec<String>, String> {
        let output = script(
            "function run() { ObjC.import('AppKit'); const pb = $.NSPasteboard.generalPasteboard; const urls = pb.readObjectsForClassesOptions($.NSArray.arrayWithObject($.NSURL), $({ NSPasteboardURLReadingFileURLsOnlyKey: true })); const out = []; if (urls) { for (let i = 0; i < urls.count; i++) { out.push(ObjC.unwrap(urls.objectAtIndex(i).path)); } } return JSON.stringify(out); }",
            None,
        )?;
        // The result is a JSON array of strings; parse it without extra dependencies.
        let mut paths = Vec::new();
        let mut current = String::new();
        let mut inside = false;
        let mut escaped = false;
        for ch in output.chars() {
            if inside {
                if escaped {
                    current.push(ch);
                    escaped = false;
                } else if ch == '\\' {
                    escaped = true;
                } else if ch == '"' {
                    inside = false;
                    paths.push(std::mem::take(&mut current));
                } else {
                    current.push(ch);
                }
            } else if ch == '"' {
                inside = true;
            }
        }
        Ok(paths)
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
mod platform {
    use std::path::PathBuf;

    pub fn write_files(_paths: &[PathBuf]) -> Result<(), String> {
        Err("이 운영체제에서는 파일 클립보드를 지원하지 않습니다.".into())
    }

    pub fn read_files() -> Result<Vec<String>, String> {
        Err("이 운영체제에서는 파일 클립보드를 지원하지 않습니다.".into())
    }
}
