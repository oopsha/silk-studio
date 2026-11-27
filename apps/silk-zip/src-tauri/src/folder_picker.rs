//! "Choose where to extract": the Windows folder dialog with one extra check box. The dialog
//! plugin cannot add controls, so the dialog is opened here.
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PickedFolder {
    pub dir: String,
    /// "Make a folder named after the archive" was checked.
    pub named: bool,
}

/// The check box: for one archive its text names the folder that would be made in the folder
/// shown, so it follows the dialog (`archive`); for several it stays as it is.
struct Check {
    named: bool,
    archive: Option<std::path::PathBuf>,
}

impl Check {
    fn new(archive: &str, count: usize, named: bool) -> Self {
        Self { named, archive: (count <= 1).then(|| archive.into()) }
    }
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
    let (default_path, check) = (parent_of(archive), Check::new(archive, count, named));
    let (sender, receiver) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = sender.send(windows_dialog::show(None, default_path, check).ok().flatten());
    });
    PendingFolder(std::sync::Mutex::new(Some(receiver)))
}

/// Waits for the start-up dialog; `None` when it was cancelled (or there was no such dialog).
#[tauri::command]
pub async fn wait_extract_folder(
    pending: tauri::State<'_, PendingFolder>,
) -> Result<Option<PickedFolder>, String> {
    let Some(receiver) = pending.0.lock().map_err(|error| error.to_string())?.take() else {
        return Ok(None);
    };
    tauri::async_runtime::spawn_blocking(move || receiver.recv().ok().flatten())
        .await
        .map_err(|error| error.to_string())
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
        let (default_path, check) = (parent_of(&archive_path), Check::new(&archive_path, count, named));
        tauri::async_runtime::spawn_blocking(move || {
            // The shell dialog needs a single-threaded apartment of its own.
            std::thread::spawn(move || windows_dialog::show(owner, default_path, check))
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
    use super::{Check, PickedFolder};
    use std::path::{Path, PathBuf};
    use windows::core::{Interface, HSTRING};
    use windows::Win32::Foundation::E_NOTIMPL;
    use windows::Win32::Foundation::{ERROR_CANCELLED, HWND};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::{
        FileOpenDialog, IFileDialog, IFileDialogCustomize, IFileDialogEvents, IFileDialogEvents_Impl, IFileOpenDialog,
        IShellItem, SHCreateItemFromParsingName, FDE_OVERWRITE_RESPONSE, FDE_SHAREVIOLATION_RESPONSE, FOS_FORCEFILESYSTEM,
        FOS_PICKFOLDERS, SIGDN_FILESYSPATH,
    };
    use windows_core::{implement, Ref};

    const NAMED_CHECK: u32 = 1;

    fn path_of(item: &IShellItem) -> windows::core::Result<PathBuf> {
        unsafe {
            let name = item.GetDisplayName(SIGDN_FILESYSPATH)?;
            let path = name.to_string();
            CoTaskMemFree(Some(name.0 as *const _));
            Ok(path?.into())
        }
    }

    fn label_in(archive: &Path, folder: &Path) -> HSTRING {
        HSTRING::from(silk_zip_menu::named_folder_label(archive, folder, &|path| path.exists()))
    }

    /// Renames the check box after the folder that "폴더 선택" would take: the selected one, or
    /// else the one being shown.
    #[implement(IFileDialogEvents)]
    struct FollowFolder {
        archive: PathBuf,
    }

    impl FollowFolder_Impl {
        fn relabel(&self, dialog: Ref<'_, IFileDialog>) {
            let Some(dialog) = dialog.as_ref() else { return };
            unsafe {
                let Ok(item) = dialog.GetCurrentSelection().or_else(|_| dialog.GetFolder()) else { return };
                let (Ok(folder), Ok(custom)) = (path_of(&item), dialog.cast::<IFileDialogCustomize>()) else { return };
                let _ = custom.SetControlLabel(NAMED_CHECK, &label_in(&self.archive, &folder));
            }
        }
    }

    impl IFileDialogEvents_Impl for FollowFolder_Impl {
        fn OnFileOk(&self, _dialog: Ref<'_, IFileDialog>) -> windows::core::Result<()> {
            Ok(())
        }
        fn OnFolderChanging(&self, _dialog: Ref<'_, IFileDialog>, _folder: Ref<'_, IShellItem>) -> windows::core::Result<()> {
            Ok(())
        }
        fn OnFolderChange(&self, dialog: Ref<'_, IFileDialog>) -> windows::core::Result<()> {
            self.relabel(dialog);
            Ok(())
        }
        fn OnSelectionChange(&self, dialog: Ref<'_, IFileDialog>) -> windows::core::Result<()> {
            self.relabel(dialog);
            Ok(())
        }
        fn OnShareViolation(&self, _dialog: Ref<'_, IFileDialog>, _item: Ref<'_, IShellItem>) -> windows::core::Result<FDE_SHAREVIOLATION_RESPONSE> {
            Err(E_NOTIMPL.into())
        }
        fn OnTypeChange(&self, _dialog: Ref<'_, IFileDialog>) -> windows::core::Result<()> {
            Ok(())
        }
        fn OnOverwrite(&self, _dialog: Ref<'_, IFileDialog>, _item: Ref<'_, IShellItem>) -> windows::core::Result<FDE_OVERWRITE_RESPONSE> {
            Err(E_NOTIMPL.into())
        }
    }

    pub fn show(owner: Option<isize>, default_path: Option<String>, check: Check) -> windows::core::Result<Option<PickedFolder>> {
        unsafe {
            CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok()?;
            let result = run(owner, default_path, check);
            CoUninitialize();
            result
        }
    }

    unsafe fn run(owner: Option<isize>, default_path: Option<String>, check: Check) -> windows::core::Result<Option<PickedFolder>> {
        let dialog: IFileOpenDialog = CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER)?;
        dialog.SetOptions(dialog.GetOptions()? | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM)?;
        dialog.SetTitle(&HSTRING::from("압축을 풀 폴더 선택"))?;
        // Several archives: one fixed text; one archive: named after it, updated by `FollowFolder`.
        let label = match &check.archive {
            Some(archive) => label_in(archive, Path::new(default_path.as_deref().unwrap_or_default())),
            None => HSTRING::from("각각 폴더에 풀기"),
        };
        if let Some(path) = default_path {
            // A folder that is gone just leaves the dialog where it opens by itself.
            if let Ok(item) = SHCreateItemFromParsingName::<_, _, IShellItem>(&HSTRING::from(path), None) {
                let _ = dialog.SetFolder(&item);
            }
        }
        let custom: IFileDialogCustomize = dialog.cast()?;
        // The dialog wraps a long text onto a second line by itself.
        custom.AddCheckButton(NAMED_CHECK, &label, check.named)?;
        let cookie = match check.archive {
            Some(archive) => {
                let events: IFileDialogEvents = FollowFolder { archive }.into();
                dialog.Advise(&events).ok()
            }
            None => None,
        };
        let shown = dialog.Show(owner.map(|handle| HWND(handle as *mut _)));
        if let Some(cookie) = cookie {
            let _ = dialog.Unadvise(cookie);
        }
        if let Err(error) = shown {
            return if error.code() == ERROR_CANCELLED.to_hresult() { Ok(None) } else { Err(error) };
        }
        let name = dialog.GetResult()?.GetDisplayName(SIGDN_FILESYSPATH)?;
        let dir = name.to_string();
        CoTaskMemFree(Some(name.0 as *const _));
        let named = custom.GetCheckButtonState(NAMED_CHECK)?.as_bool();
        Ok(Some(PickedFolder { dir: dir?, named }))
    }
}
