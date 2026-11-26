//! "Choose where to extract": the Windows folder dialog with one extra check box. The dialog
//! plugin cannot add controls, so the dialog is opened here.
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PickedFolder {
    pub dir: String,
    /// "Make a folder named after the archive" was checked.
    pub named: bool,
}

/// Text of the check box: the archive's own folder name for one archive.
fn check_label(archive: &str, count: usize) -> String {
    #[cfg(windows)]
    if count <= 1 {
        return silk_zip_menu::named_folder_label(std::path::Path::new(archive));
    }
    let _ = archive;
    if count > 1 { "각각 폴더에 풀기".into() } else { "압축 파일명으로 폴더를 만들어 풀기".into() }
}

fn parent_of(archive: &str) -> Option<String> {
    std::path::Path::new(archive).parent().map(|folder| folder.to_string_lossy().into_owned()).filter(|folder| !folder.is_empty())
}

/// The answer of a dialog opened at start-up; `None` inside when it was cancelled.
#[derive(Default)]
pub struct PendingFolder(pub std::sync::Mutex<Option<std::sync::mpsc::Receiver<Option<PickedFolder>>>>);

/// Opens the dialog at once on its own thread (Explorer's "Silk Zip으로 압축 풀기..."), while the
/// app and its web view start up hidden behind it.
#[cfg(windows)]
pub fn pick_in_background(archive: &str, count: usize, named: bool) -> PendingFolder {
    let (default_path, label) = (parent_of(archive), check_label(archive, count));
    let (sender, receiver) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = sender.send(windows_dialog::show(None, default_path, named, label).ok().flatten());
    });
    PendingFolder(std::sync::Mutex::new(Some(receiver)))
}

/// Waits for the start-up dialog. With a folder the hidden job window is shown; `None` when it
/// was cancelled (or there was no such dialog).
#[tauri::command]
pub async fn wait_extract_folder(
    window: tauri::WebviewWindow,
    quick: tauri::State<'_, crate::launch::QuickMode>,
    pending: tauri::State<'_, PendingFolder>,
) -> Result<Option<PickedFolder>, String> {
    let Some(receiver) = pending.0.lock().map_err(|error| error.to_string())?.take() else {
        return Ok(None);
    };
    let picked = tauri::async_runtime::spawn_blocking(move || receiver.recv().ok().flatten())
        .await
        .map_err(|error| error.to_string())?;
    if picked.is_some() {
        quick.1.store(false, std::sync::atomic::Ordering::SeqCst);
        let _ = window.center();
        let _ = window.show();
        let _ = window.set_focus();
    }
    Ok(picked)
}

/// `None` when the dialog was cancelled.
#[tauri::command]
pub async fn pick_extract_folder(
    window: tauri::WebviewWindow,
    archive_path: String,
    count: usize,
    named: bool,
) -> Result<Option<PickedFolder>, String> {
    #[cfg(windows)]
    {
        // A hidden window must not own the dialog: unowned, it gets its own taskbar button.
        let owner = match window.is_visible() {
            Ok(true) => window.hwnd().map(|handle| handle.0 as isize).ok(),
            _ => None,
        };
        let (default_path, label) = (parent_of(&archive_path), check_label(&archive_path, count));
        tauri::async_runtime::spawn_blocking(move || {
            // The shell dialog needs a single-threaded apartment of its own.
            std::thread::spawn(move || windows_dialog::show(owner, default_path, named, label))
                .join()
                .map_err(|_| "폴더 선택창을 열지 못했습니다.".to_string())?
                .map_err(|error| format!("폴더 선택창을 열지 못했습니다: {error}"))
        })
        .await
        .map_err(|_| "폴더 선택창을 열지 못했습니다.".to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (window, archive_path, count, named);
        Err("이 운영체제에서는 지원하지 않습니다.".to_string())
    }
}

#[cfg(windows)]
mod windows_dialog {
    use super::PickedFolder;
    use windows::core::{Interface, HSTRING};
    use windows::Win32::Foundation::{ERROR_CANCELLED, HWND};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::{
        FileOpenDialog, IFileDialogCustomize, IFileOpenDialog, IShellItem, SHCreateItemFromParsingName,
        FOS_FORCEFILESYSTEM, FOS_PICKFOLDERS, SIGDN_FILESYSPATH,
    };

    const NAMED_CHECK: u32 = 1;

    pub fn show(owner: Option<isize>, default_path: Option<String>, named: bool, label: String) -> windows::core::Result<Option<PickedFolder>> {
        unsafe {
            CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok()?;
            let result = run(owner, default_path, named, &label);
            CoUninitialize();
            result
        }
    }

    unsafe fn run(owner: Option<isize>, default_path: Option<String>, named: bool, label: &str) -> windows::core::Result<Option<PickedFolder>> {
        let dialog: IFileOpenDialog = CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER)?;
        dialog.SetOptions(dialog.GetOptions()? | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM)?;
        dialog.SetTitle(&HSTRING::from("압축을 풀 폴더 선택"))?;
        if let Some(path) = default_path {
            // A folder that is gone just leaves the dialog where it opens by itself.
            if let Ok(item) = SHCreateItemFromParsingName::<_, _, IShellItem>(&HSTRING::from(path), None) {
                let _ = dialog.SetFolder(&item);
            }
        }
        let custom: IFileDialogCustomize = dialog.cast()?;
        // The dialog wraps a long text onto a second line by itself.
        custom.AddCheckButton(NAMED_CHECK, &HSTRING::from(label), named)?;
        if let Err(error) = dialog.Show(owner.map(|handle| HWND(handle as *mut _))) {
            return if error.code() == ERROR_CANCELLED.to_hresult() { Ok(None) } else { Err(error) };
        }
        let name = dialog.GetResult()?.GetDisplayName(SIGDN_FILESYSPATH)?;
        let dir = name.to_string();
        CoTaskMemFree(Some(name.0 as *const _));
        let named = custom.GetCheckButtonState(NAMED_CHECK)?.as_bool();
        Ok(Some(PickedFolder { dir: dir?, named }))
    }
}
