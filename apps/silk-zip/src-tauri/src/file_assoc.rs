//! File associations (설정 > 파일 연결), written under HKCU so they need no administrator rights.
//! Each extension gets a `SilkZip.<ext>` ProgID and an `OpenWithProgids` entry, and the app is
//! listed in Windows' default apps through `RegisteredApplications`. Windows 10/11 keep the
//! user's own choice (`UserChoice`) and do not let an app overwrite it, so where another app is
//! already the default the user confirms Silk Zip in the Windows settings page this opens.
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Association {
    extension: String,
    registered: bool,
    is_default: bool,
}

#[cfg(windows)]
mod imp {
    use super::Association;
    use std::io;
    use winreg::enums::{HKEY_CURRENT_USER, KEY_ALL_ACCESS};
    use winreg::RegKey;

    const CLASSES: &str = r"Software\Classes";
    const PROG_PREFIX: &str = "SilkZip.";
    const APP_NAME: &str = "Silk Zip";
    const CAPABILITIES: &str = r"Software\SilkZip\Capabilities";
    pub const EXTENSIONS: &[&str] = crate::shell_menu::ARCHIVE_EXTENSIONS;

    fn prog_id(extension: &str) -> String {
        format!("{PROG_PREFIX}{extension}")
    }

    fn classes() -> io::Result<RegKey> {
        Ok(RegKey::predef(HKEY_CURRENT_USER).create_subkey(CLASSES)?.0)
    }

    fn is_registered(classes: &RegKey, extension: &str) -> bool {
        classes
            .open_subkey(format!(r".{extension}\OpenWithProgids"))
            .and_then(|key| key.get_raw_value(prog_id(extension)))
            .is_ok()
    }

    /// The ProgID the user chose in Windows. Newer builds keep it in `UserChoiceLatest\ProgId`
    /// (a subkey), which then supersedes the old `UserChoice`.
    fn user_choice(extension: &str) -> Option<String> {
        let user = RegKey::predef(HKEY_CURRENT_USER);
        let base = format!(r"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.{extension}");
        [r"UserChoiceLatest\ProgId", "UserChoice"]
            .iter()
            .find_map(|name| user.open_subkey(format!(r"{base}\{name}")).and_then(|key| key.get_value::<String, _>("ProgId")).ok())
            .filter(|id| !id.is_empty())
    }

    /// The ProgID the shell resolves for the extension; only meaningful without a user choice.
    fn shell_prog_id(extension: &str) -> Option<String> {
        use windows::core::{HSTRING, PCWSTR, PWSTR};
        use windows::Win32::UI::Shell::{AssocQueryStringW, ASSOCF_NONE, ASSOCSTR_PROGID};
        let name = HSTRING::from(format!(".{extension}"));
        let mut buffer = [0u16; 260];
        let mut length = buffer.len() as u32;
        let result = unsafe {
            AssocQueryStringW(ASSOCF_NONE, ASSOCSTR_PROGID, &name, PCWSTR::null(), Some(PWSTR(buffer.as_mut_ptr())), &mut length)
        };
        if result.is_err() {
            return None;
        }
        let end = buffer.iter().position(|&unit| unit == 0).unwrap_or(buffer.len());
        Some(String::from_utf16_lossy(&buffer[..end]))
    }

    pub fn list() -> Vec<Association> {
        let classes = classes().ok();
        EXTENSIONS
            .iter()
            .map(|extension| Association {
                extension: extension.to_string(),
                registered: classes.as_ref().is_some_and(|classes| is_registered(classes, extension)),
                is_default: user_choice(extension)
                    .or_else(|| shell_prog_id(extension))
                    .is_some_and(|id| id.eq_ignore_ascii_case(&prog_id(extension))),
            })
            .collect()
    }

    fn register(classes: &RegKey, capabilities: &RegKey, extension: &str, exe: &str) -> io::Result<()> {
        let id = prog_id(extension);
        let (prog, _) = classes.create_subkey(&id)?;
        prog.set_value("", &format!("{} {}", extension.to_uppercase(), crate::language::pick("압축 파일", "Archive")))?;
        prog.create_subkey("DefaultIcon")?.0.set_value("", &format!("\"{exe}\",0"))?;
        prog.create_subkey(r"shell\open\command")?.0.set_value("", &format!("\"{exe}\" --action=open --batch \"%1\""))?;
        let (class, _) = classes.create_subkey(format!(".{extension}"))?;
        class.create_subkey("OpenWithProgids")?.0.set_value(&id, &"")?;
        // Used only when the user has not chosen an app for the extension.
        let current: String = class.get_value("").unwrap_or_default();
        if current.is_empty() {
            class.set_value("", &id)?;
        }
        capabilities.create_subkey("FileAssociations")?.0.set_value(format!(".{extension}"), &id)?;
        Ok(())
    }

    fn unregister(classes: &RegKey, extension: &str) -> io::Result<()> {
        let id = prog_id(extension);
        if let Ok(class) = classes.open_subkey_with_flags(format!(".{extension}"), KEY_ALL_ACCESS) {
            if let Ok(list) = class.open_subkey_with_flags("OpenWithProgids", KEY_ALL_ACCESS) {
                let _ = list.delete_value(&id);
            }
            if class.get_value::<String, _>("").is_ok_and(|current| current == id) {
                let _ = class.delete_value("");
            }
        }
        if let Ok(files) = RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(format!(r"{CAPABILITIES}\FileAssociations"), KEY_ALL_ACCESS) {
            let _ = files.delete_value(format!(".{extension}"));
        }
        match classes.delete_subkey_all(&id) {
            Err(error) if error.kind() != io::ErrorKind::NotFound => Err(error),
            _ => Ok(()),
        }
    }

    fn notify() {
        use windows::Win32::UI::Shell::{SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNF_IDLIST};
        unsafe { SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, None, None) };
    }

    /// Registers exactly `wanted` (other Silk Zip associations are removed).
    pub fn apply(wanted: &[String]) -> io::Result<()> {
        let exe = std::env::current_exe()?.to_string_lossy().into_owned();
        let classes = classes()?;
        let user = RegKey::predef(HKEY_CURRENT_USER);
        let (capabilities, _) = user.create_subkey(CAPABILITIES)?;
        capabilities.set_value("ApplicationName", &APP_NAME)?;
        capabilities.set_value("ApplicationDescription", &crate::language::pick("압축 파일을 만들고 풉니다.", "Create and extract archives."))?;
        for extension in EXTENSIONS {
            if wanted.iter().any(|item| item.eq_ignore_ascii_case(extension)) {
                register(&classes, &capabilities, extension, &exe)?;
            } else {
                unregister(&classes, extension)?;
            }
        }
        let (apps, _) = user.create_subkey(r"Software\RegisteredApplications")?;
        if wanted.is_empty() {
            let _ = apps.delete_value(APP_NAME);
        } else {
            apps.set_value(APP_NAME, &CAPABILITIES)?;
        }
        notify();
        Ok(())
    }

    /// Removes everything `apply` wrote (uninstall).
    pub fn remove_all() -> io::Result<()> {
        apply(&[])?;
        let user = RegKey::predef(HKEY_CURRENT_USER);
        match user.delete_subkey_all(r"Software\SilkZip") {
            Err(error) if error.kind() != io::ErrorKind::NotFound => Err(error),
            _ => Ok(()),
        }
    }

    pub fn open_settings() -> io::Result<()> {
        use windows::core::{w, HSTRING, PCWSTR};
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        // `explorer <uri>` drops the query and opens Documents; the shell resolves it properly.
        let uri = HSTRING::from(format!("ms-settings:defaultapps?registeredAppUser={}", APP_NAME.replace(' ', "%20")));
        let result = unsafe { ShellExecuteW(None, w!("open"), &uri, PCWSTR::null(), PCWSTR::null(), SW_SHOWNORMAL) };
        // Values above 32 mean success.
        if result.0 as isize > 32 {
            Ok(())
        } else {
            Err(io::Error::other("Windows 설정을 열지 못했습니다."))
        }
    }
}

#[cfg(windows)]
pub use imp::remove_all;

#[tauri::command]
pub fn file_associations() -> Vec<Association> {
    #[cfg(windows)]
    return imp::list();
    #[cfg(not(windows))]
    Vec::new()
}

#[tauri::command]
pub fn set_file_associations(extensions: Vec<String>) -> Result<Vec<Association>, String> {
    #[cfg(windows)]
    {
        imp::apply(&extensions).map_err(|error| format!("파일 연결을 저장하지 못했습니다: {error}"))?;
        Ok(imp::list())
    }
    #[cfg(not(windows))]
    {
        let _ = extensions;
        Ok(Vec::new())
    }
}

#[tauri::command]
pub fn open_default_apps_settings() -> Result<(), String> {
    #[cfg(windows)]
    return imp::open_settings().map_err(|error| error.to_string());
    #[cfg(not(windows))]
    Ok(())
}
