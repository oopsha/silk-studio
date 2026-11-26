//! Explorer's classic ("추가 옵션 표시") context menu: one top-level entry per action on every
//! file and folder, written under HKCU so it needs no administrator rights. Each entry starts
//! the app as `silk-zip --action=<action> <paths>` (see `launch.rs`).
use std::io;
use winreg::enums::{HKEY_CURRENT_USER, KEY_ALL_ACCESS};
use winreg::RegKey;

const CLASSES: &str = r"Software\Classes";
const TARGETS: &[&str] = &["*", "Directory"];
const VERB_PREFIX: &str = "SilkZip.";
const ARCHIVE_EXTENSIONS: &[&str] = &[
    "zip", "zipx", "tar", "tgz", "taz", "gz", "gzip", "bz2", "xz", "txz", "lz", "lzma", "lzh", "lha", "iso", "7z", "zpaq", "rar", "rar5",
];

/// (key name = sort order, label with `&` accelerator, action, only for archives, separator before)
const ITEMS: &[(&str, &str, &str, bool, bool)] = &[
    ("01", "Silk Zip으로 열기(&O)", "open", true, true),
    ("02", "여기에 풀기(&X)", "extract-here", true, false),
    ("03", "파일명 폴더에 풀기(&E)", "extract-folder", true, false),
    ("04", "ZIP으로 압축하기(&Z)", "compress-zip", false, true),
    ("05", "7z로 압축하기(&7)", "compress-7z", false, false),
    ("06", "각각 ZIP으로 압축하기(&U)", "compress-each", false, false),
    ("07", "Silk Zip으로 압축하기(&L)...", "compress-dialog", false, false),
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
    let exe = exe.to_string_lossy();
    let classes = RegKey::predef(HKEY_CURRENT_USER).create_subkey(CLASSES)?.0;
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

pub fn unregister() -> io::Result<()> {
    let classes = RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(CLASSES, KEY_ALL_ACCESS)?;
    let mut keys = vec!["SilkZip.Menu".to_string(), r"*\shell\SilkZip".to_string(), r"Directory\shell\SilkZip".to_string()];
    for target in TARGETS {
        // "07" was an entry of earlier versions.
        for order in ITEMS.iter().map(|item| item.0).chain(["07"]) {
            keys.push(format!(r"{target}\shell\{VERB_PREFIX}{order}"));
        }
    }
    for key in keys {
        match classes.delete_subkey_all(key) {
            Err(error) if error.kind() != io::ErrorKind::NotFound => return Err(error),
            _ => {}
        }
    }
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
