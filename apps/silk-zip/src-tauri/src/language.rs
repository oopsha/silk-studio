//! The display language for the parts drawn outside the web view (Explorer menu, folder dialog,
//! file type names). The front end writes it to `HKCU\Software\SilkZip\Language`; until then the
//! Windows display language decides. The Explorer extension reads the same value.

#[cfg(windows)]
mod imp {
    use silk_zip_menu::Lang;
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    const KEY: &str = r"Software\SilkZip";
    const VALUE: &str = "Language";

    pub fn current() -> Lang {
        RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey(KEY)
            .and_then(|key| key.get_value::<String, _>(VALUE))
            .ok()
            .and_then(|code| Lang::from_code(&code))
            .unwrap_or_else(|| {
                // Primary language 0x12 is Korean.
                let language = unsafe { windows::Win32::Globalization::GetUserDefaultUILanguage() };
                if language & 0x3ff == 0x12 {
                    Lang::Ko
                } else {
                    Lang::En
                }
            })
    }

    pub fn save(code: &str) -> std::io::Result<()> {
        RegKey::predef(HKEY_CURRENT_USER).create_subkey(KEY)?.0.set_value(VALUE, &code)
    }
}

#[cfg(windows)]
pub use imp::current;

/// `korean` or `english`, whichever the display language calls for.
#[cfg(windows)]
pub fn pick(korean: &'static str, english: &'static str) -> &'static str {
    match current() {
        silk_zip_menu::Lang::Ko => korean,
        silk_zip_menu::Lang::En => english,
    }
}

#[tauri::command]
pub fn set_native_language(language: String) -> Result<(), String> {
    #[cfg(windows)]
    if language == "ko" || language == "en" {
        imp::save(&language).map_err(|error| error.to_string())?;
    }
    #[cfg(not(windows))]
    let _ = language;
    Ok(())
}
