//! Explorer's classic ("추가 옵션 표시") context menu, written under HKCU so it needs no
//! administrator rights. When the extension DLL (`crates/silk-zip-shell`) is next to the exe, a
//! copy of it is registered and builds the menu itself (file names, entries by selection count). Without it,
//! fixed registry verbs are written instead. Either way an entry starts the app as
//! `silk-zip --action=<action> <paths>` (see `launch.rs`).
use std::io;
use winreg::enums::{HKEY_CURRENT_USER, KEY_ALL_ACCESS};
use winreg::RegKey;

const CLASSES: &str = r"Software\Classes";
const TARGETS: &[&str] = &["*", "Directory"];
const VERB_PREFIX: &str = "SilkZip.";
const EXTENSION_DLL: &str = "silk_zip_shell.dll";
/// Keep equal to `CLSID_MENU` in `crates/silk-zip-shell/src/com.rs`.
const CLSID: &str = "{7B3E9A52-4C1D-4E8F-9A67-2D5B0C8F1E34}";
const HANDLER: &str = r"shellex\ContextMenuHandlers\SilkZip";
const ARCHIVE_EXTENSIONS: &[&str] = &[
    "zip", "zipx", "tar", "tgz", "taz", "gz", "gzip", "bz2", "xz", "txz", "lz", "lzma", "lzh", "lha", "iso", "7z", "zpaq", "rar", "rar5",
];

/// (key name = sort order, label with `&` accelerator, action, only for archives, separator before)
const ITEMS: &[(&str, &str, &str, bool, bool)] = &[
    ("01", "Silk Zip으로 열기(&O)", "open", true, true),
    ("02", "여기에 풀기(&X)", "extract-here", true, false),
    ("03", "파일명 폴더에 풀기(&E)", "extract-folder", true, false),
    ("04", "Silk Zip으로 압축 풀기(&T)...", "extract-dialog", true, false),
    ("05", "ZIP으로 압축하기(&Z)", "compress-zip", false, true),
    ("06", "7z로 압축하기(&7)", "compress-7z", false, false),
    ("07", "각각 ZIP으로 압축하기(&U)", "compress-each", false, false),
    ("08", "Silk Zip으로 압축하기(&L)...", "compress-dialog", false, false),
];

fn archive_filter() -> String {
    ARCHIVE_EXTENSIONS
        .iter()
        .map(|extension| format!("System.FileExtension:=\".{extension}\""))
        .collect::<Vec<_>>()
        .join(" OR ")
}

pub fn register() -> io::Result<()> {
    unregister()?;
    let exe = std::env::current_exe()?;
    let classes = RegKey::predef(HKEY_CURRENT_USER).create_subkey(CLASSES)?.0;
    let dll = exe.with_file_name(EXTENSION_DLL);
    if dll.is_file() {
        return register_extension(&classes, &dll, &exe);
    }
    let exe = exe.to_string_lossy();
    let filter = archive_filter();
    for target in TARGETS {
        for (order, label, action, archives_only, separator) in ITEMS {
            // Explorer treats an archive as a folder too, and a `Directory` verb gets no path
            // for it; archive-only entries are therefore registered for files (`*`) only.
            if *archives_only && *target == "Directory" {
                continue;
            }
            let (item, _) = classes.create_subkey(format!(r"{target}\shell\{VERB_PREFIX}{order}"))?;
            item.set_value("MUIVerb", label)?;
            item.set_value("Icon", &format!("\"{exe}\",0"))?;
            if *archives_only {
                item.set_value("AppliesTo", &filter)?;
            }
            if *separator {
                item.set_value("SeparatorBefore", &"")?;
            }
            let (command, _) = item.create_subkey("command")?;
            command.set_value("", &format!("\"{exe}\" --action={action} \"%1\""))?;
        }
    }
    Ok(())
}

/// Folder of the registered DLL copies: `%LOCALAPPDATA%\com.oopsha.silk-zip\shell`.
fn copies_folder() -> Option<std::path::PathBuf> {
    Some(std::path::PathBuf::from(std::env::var_os("LOCALAPPDATA")?).join("com.oopsha.silk-zip").join("shell"))
}

/// Deletes the copies Explorer no longer has loaded; the loaded one stays until it is restarted.
fn remove_old_copies() {
    let Some(entries) = copies_folder().and_then(|folder| std::fs::read_dir(folder).ok()) else { return };
    for entry in entries.flatten() {
        let _ = std::fs::remove_file(entry.path());
    }
}

/// Explorer keeps a loaded extension open until it exits, so registering the built or installed
/// DLL itself would lock that file against the next build or update. A copy with a new name is
/// registered instead; the DLL finds the app through the `App` value written here.
fn register_extension(classes: &RegKey, dll: &std::path::Path, exe: &std::path::Path) -> io::Result<()> {
    remove_old_copies();
    let folder = copies_folder().ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "LOCALAPPDATA가 없습니다."))?;
    std::fs::create_dir_all(&folder)?;
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|time| time.as_millis()).unwrap_or(0);
    let copy = folder.join(format!("silk_zip_shell-{stamp}.dll"));
    std::fs::copy(dll, &copy)?;
    let (class, _) = classes.create_subkey(format!(r"CLSID\{CLSID}"))?;
    class.set_value("App", &exe.as_os_str())?;
    let (server, _) = class.create_subkey("InprocServer32")?;
    server.set_value("", &copy.as_os_str())?;
    server.set_value("ThreadingModel", &"Apartment")?;
    for target in TARGETS {
        let (handler, _) = classes.create_subkey(format!(r"{target}\{HANDLER}"))?;
        handler.set_value("", &CLSID)?;
    }
    Ok(())
}

pub fn unregister() -> io::Result<()> {
    let classes = RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(CLASSES, KEY_ALL_ACCESS)?;
    let mut keys = vec!["SilkZip.Menu".to_string(), r"*\shell\SilkZip".to_string(), r"Directory\shell\SilkZip".to_string()];
    keys.push(format!(r"CLSID\{CLSID}"));
    for target in TARGETS {
        keys.push(format!(r"{target}\{HANDLER}"));
        for order in ITEMS.iter().map(|item| item.0) {
            keys.push(format!(r"{target}\shell\{VERB_PREFIX}{order}"));
        }
    }
    for key in keys {
        match classes.delete_subkey_all(key) {
            Err(error) if error.kind() != io::ErrorKind::NotFound => return Err(error),
            _ => {}
        }
    }
    remove_old_copies();
    Ok(())
}

/// Handles `--register-shell` / `--unregister-shell`; true when the process should exit.
pub fn handle_args() -> bool {
    for arg in std::env::args().skip(1) {
        let result = match arg.as_str() {
            "--register-shell" => register(),
            "--unregister-shell" => unregister(),
            _ => continue,
        };
        if let Err(error) = result {
            eprintln!("탐색기 메뉴 설정에 실패했습니다: {error}");
        }
        return true;
    }
    false
}
