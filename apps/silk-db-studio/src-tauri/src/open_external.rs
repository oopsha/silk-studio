use url::Url;

fn validate_external_url(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    let url = Url::parse(trimmed).map_err(|error| format!("Invalid URL: {error}"))?;
    match url.scheme() {
        "http" | "https" => Ok(trimmed.to_string()),
        other => Err(format!("Only http(s) URLs can be opened (got {other}).")),
    }
}

/// Open an http(s) URL in the OS default browser.
#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    let url = validate_external_url(&url)?;

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|error| format!("Failed to open URL: {error}"))?;
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        // `start` is a cmd built-in; empty title arg avoids treating the URL as a title.
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &url])
            .spawn()
            .map_err(|error| format!("Failed to open URL: {error}"))?;
        return Ok(());
    }

    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|error| format!("Failed to open URL: {error}"))?;
        Ok(())
    }
}
