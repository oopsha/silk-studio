//! What the app was asked to do when it was started, e.g. from an Explorer or Finder menu:
//! `silk-zip --action=extract-here <path>...`. A bare list of paths means "open it".
use serde::Serialize;
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;
use tauri::State;

/// Actions the front end understands; anything else is passed on as `open`.
const ACTIONS: &[&str] = &[
    "open",
    "extract-here",
    "extract-folder",
    "extract-dialog",
    "compress-zip",
    "compress-7z",
    "compress-each",
    "compress-dialog",
];

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchRequest {
    pub action: String,
    pub paths: Vec<String>,
    /// All paths came in one process (the Explorer extension), so there is no burst to collect.
    #[serde(skip)]
    pub batch: bool,
}

#[derive(Default)]
pub struct LaunchState(pub Mutex<Option<LaunchRequest>>);

/// `.0`: true while the app runs only to do one Explorer-menu job: it shows a small window with the
/// progress and result, and leaves the saved window layout alone.
/// `.1`: the job window stays hidden until the start-up folder dialog has been answered.
#[derive(Default)]
pub struct QuickMode(pub bool, pub AtomicBool);

/// Actions that run without the main window.
pub fn is_quick(action: &str) -> bool {
    matches!(action, "extract-here" | "extract-folder" | "extract-dialog" | "compress-zip" | "compress-7z" | "compress-each")
}

/// Reads the request out of the command line (without the program name); `None` when no
/// path was given, so a plain start or `--new-window` opens the empty window as before.
pub fn parse_args<I: IntoIterator<Item = String>>(args: I) -> Option<LaunchRequest> {
    let mut action = String::from("open");
    let mut paths = Vec::new();
    let mut batch = false;
    let mut args = args.into_iter();
    while let Some(arg) = args.next() {
        if let Some(value) = arg.strip_prefix("--action=") {
            action = value.to_string();
        } else if arg == "--action" {
            if let Some(value) = args.next() {
                action = value;
            }
        } else if arg == "--batch" {
            batch = true;
        } else if arg.starts_with("--") {
            continue;
        } else if !arg.is_empty() {
            paths.push(arg);
        }
    }
    if paths.is_empty() {
        return None;
    }
    if !ACTIONS.contains(&action.as_str()) {
        action = "open".into();
    }
    Some(LaunchRequest { action, paths, batch })
}

/// Explorer starts the app once per selected item. The first process of a burst (the one that
/// creates the lock file) waits a moment, collects the paths every other process left in a
/// list file, and carries on with all of them; the others leave their path and exit.
fn gather(request: LaunchRequest) -> Option<LaunchRequest> {
    use std::io::Write;
    let dir = std::env::temp_dir();
    let list = dir.join(format!("silk-zip-batch-{}.list", request.action));
    let lock = dir.join(format!("silk-zip-batch-{}.lock", request.action));
    if std::fs::metadata(&lock)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|modified| modified.elapsed().ok())
        .is_some_and(|age| age > std::time::Duration::from_secs(10))
    {
        let _ = std::fs::remove_file(&lock);
        let _ = std::fs::remove_file(&list);
    }
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(&list) {
        for path in &request.paths {
            let _ = writeln!(file, "{path}");
        }
    }
    if std::fs::OpenOptions::new().write(true).create_new(true).open(&lock).is_err() {
        return None; // another process of this burst handles everything
    }
    std::thread::sleep(std::time::Duration::from_millis(600));
    let mut paths: Vec<String> = Vec::new();
    for line in std::fs::read_to_string(&list).unwrap_or_default().lines() {
        if !line.is_empty() && !paths.iter().any(|known| known == line) {
            paths.push(line.to_string());
        }
    }
    let _ = std::fs::remove_file(&list);
    let _ = std::fs::remove_file(&lock);
    if paths.is_empty() {
        paths = request.paths.clone();
    }
    Some(LaunchRequest { paths, ..request })
}

/// The request from the command line. `None` for a plain start; the process exits right away
/// when it only handed its paths to the process that collects the burst.
pub fn from_environment() -> Option<LaunchRequest> {
    let request = parse_args(std::env::args().skip(1))?;
    if request.batch {
        return Some(request);
    }
    match gather(request) {
        Some(merged) => Some(merged),
        None => std::process::exit(0),
    }
}

/// `path` itself when nothing exists there, else the first free `name (2).ext`, `name (3).ext`, …
#[tauri::command]
pub fn unique_path(path: String) -> String {
    let original = std::path::Path::new(&path);
    if !original.exists() {
        return path;
    }
    let stem = original.file_stem().map(|value| value.to_string_lossy().into_owned()).unwrap_or_default();
    let extension = original.extension().map(|value| format!(".{}", value.to_string_lossy())).unwrap_or_default();
    (2..)
        .map(|number| original.with_file_name(format!("{stem} ({number}){extension}")))
        .find(|candidate| !candidate.exists())
        .map(|candidate| candidate.to_string_lossy().into_owned())
        .unwrap_or(path)
}

/// Hands the start-up request to the front end once; later calls return nothing.
#[tauri::command]
pub fn take_launch_request(state: State<'_, LaunchState>) -> Option<LaunchRequest> {
    state.0.lock().ok().and_then(|mut request| request.take())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(args: &[&str]) -> Option<LaunchRequest> {
        parse_args(args.iter().map(|arg| arg.to_string()))
    }

    #[test]
    fn plain_start_has_no_request() {
        assert_eq!(parse(&[]), None);
        assert_eq!(parse(&["--new-window"]), None);
        assert_eq!(parse(&["--action=extract-here"]), None);
    }

    #[test]
    fn bare_paths_mean_open() {
        let request = parse(&["C:\\a b\\x.zip"]).unwrap();
        assert_eq!(request.action, "open");
        assert_eq!(request.paths, vec!["C:\\a b\\x.zip"]);
    }

    #[test]
    fn action_and_many_paths() {
        let request = parse(&["--action=compress-zip", "a.txt", "dir", "--new-window"]).unwrap();
        assert_eq!(request.action, "compress-zip");
        assert_eq!(request.paths, vec!["a.txt", "dir"]);
        let spaced = parse(&["--action", "extract-folder", "x.7z"]).unwrap();
        assert_eq!(spaced.action, "extract-folder");
        assert!(!spaced.batch);
        assert!(parse(&["--action=extract-here", "--batch", "x.7z"]).unwrap().batch);
    }

    #[test]
    fn unknown_action_falls_back_to_open() {
        assert_eq!(parse(&["--action=format-disk", "x.zip"]).unwrap().action, "open");
    }
}
