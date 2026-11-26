//! The COM object Explorer loads. Nothing here may panic: the code runs inside Explorer.
use silk_zip_menu::{self as menu, Selected};
use std::cell::{Cell, RefCell};
use std::ffi::{c_void, OsString};
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use windows::Win32::Foundation::{
    CLASS_E_CLASSNOTAVAILABLE, CLASS_E_NOAGGREGATION, E_FAIL, E_INVALIDARG, E_NOTIMPL, E_POINTER, HMODULE, S_FALSE,
};
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, SelectObject, BITMAPINFO, BITMAPINFOHEADER,
    BI_RGB, DIB_RGB_COLORS, HBITMAP,
};
use windows::Win32::System::Com::{
    IClassFactory, IClassFactory_Impl, IDataObject, DVASPECT_CONTENT, FORMATETC, TYMED_HGLOBAL,
};
use windows::Win32::System::LibraryLoader::{
    GetModuleFileNameW, GetModuleHandleExW, GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS,
    GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
};
use windows::Win32::System::Ole::{ReleaseStgMedium, CF_HDROP};
use windows::Win32::System::Registry::{RegGetValueW, HKEY, HKEY_CURRENT_USER, RRF_RT_REG_SZ};
use windows::Win32::UI::Shell::Common::ITEMIDLIST;
use windows::Win32::UI::Shell::{
    DragQueryFileW, ExtractIconExW, IContextMenu, IContextMenu_Impl, IShellExtInit, IShellExtInit_Impl, CMF_DEFAULTONLY,
    CMINVOKECOMMANDINFO, HDROP,
};
use windows::Win32::UI::WindowsAndMessaging::{
    DestroyIcon, DrawIconEx, GetSystemMetrics, InsertMenuW, SetMenuItemInfoW, DI_NORMAL, HICON, HMENU, MENUITEMINFOW,
    MF_BYPOSITION, MF_SEPARATOR, MF_STRING, MIIM_BITMAP, SM_CXSMICON,
};
use windows_core::{implement, IUnknown, Interface, Ref, BOOL, GUID, HRESULT, PCWSTR, PSTR};

/// Registered by `silk-zip --register-shell`; keep equal to `CLSID` in the app's `shell_menu.rs`.
const CLSID_MENU: GUID = GUID::from_u128(0x7b3e9a52_4c1d_4e8f_9a67_2d5b0c8f1e34);

/// Longest command line passed to one process; more paths go to further processes, which the
/// app merges again.
const COMMAND_LIMIT: usize = 30_000;
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// `silk-zip.exe` next to this DLL.
fn app_path() -> Option<PathBuf> {
    registered_app().or_else(app_beside_dll)
}

/// `App` under this class's key, written by `silk-zip --register-shell`: the registered DLL is a
/// copy in the user's app data, not next to the exe.
fn registered_app() -> Option<PathBuf> {
    let key = wide(r"Software\Classes\CLSID\{7B3E9A52-4C1D-4E8F-9A67-2D5B0C8F1E34}");
    let name = wide("App");
    let mut buffer = [0u16; 32_768];
    let mut size = (buffer.len() * 2) as u32;
    let status = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            PCWSTR(key.as_ptr()),
            PCWSTR(name.as_ptr()),
            RRF_RT_REG_SZ,
            None,
            Some(buffer.as_mut_ptr().cast()),
            Some(&mut size),
        )
    };
    if status.is_err() {
        return None;
    }
    let length = (size as usize / 2).saturating_sub(1);
    let path = PathBuf::from(OsString::from_wide(buffer.get(..length)?));
    path.is_file().then_some(path)
}

/// Without a registration value (a DLL registered by hand), the app is looked for beside it.
fn app_beside_dll() -> Option<PathBuf> {
    let mut module = HMODULE::default();
    let mut buffer = [0u16; 32_768];
    let length = unsafe {
        GetModuleHandleExW(
            GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
            PCWSTR(app_path as *const () as *const u16),
            &mut module,
        )
        .ok()?;
        GetModuleFileNameW(Some(module), &mut buffer) as usize
    };
    let dll = PathBuf::from(OsString::from_wide(buffer.get(..length)?));
    Some(dll.parent()?.join("silk-zip.exe"))
}

fn wide(text: impl AsRef<std::ffi::OsStr>) -> Vec<u16> {
    text.as_ref().encode_wide().chain(Some(0)).collect()
}

/// The app's small icon as a 32-bit bitmap, the form menus draw with transparency.
fn icon_bitmap() -> Option<HBITMAP> {
    let path = wide(app_path()?);
    unsafe {
        let mut icon = HICON::default();
        if ExtractIconExW(PCWSTR(path.as_ptr()), 0, None, Some(&mut icon), 1) == 0 || icon.is_invalid() {
            return None;
        }
        let size = GetSystemMetrics(SM_CXSMICON).max(16);
        let info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: size,
                biHeight: -size,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut bits: *mut c_void = std::ptr::null_mut();
        let bitmap = CreateDIBSection(None, &info, DIB_RGB_COLORS, &mut bits, None, 0).ok();
        if let Some(bitmap) = bitmap {
            let context = CreateCompatibleDC(None);
            let previous = SelectObject(context, bitmap.into());
            let _ = DrawIconEx(context, 0, 0, icon, size, size, 0, None, DI_NORMAL);
            SelectObject(context, previous);
            let _ = DeleteDC(context);
        }
        let _ = DestroyIcon(icon);
        bitmap
    }
}

fn selected_paths(data: &IDataObject) -> windows_core::Result<Vec<PathBuf>> {
    let format = FORMATETC {
        cfFormat: CF_HDROP.0,
        ptd: std::ptr::null_mut(),
        dwAspect: DVASPECT_CONTENT.0,
        lindex: -1,
        tymed: TYMED_HGLOBAL.0 as u32,
    };
    unsafe {
        let mut medium = data.GetData(&format)?;
        let drop = HDROP(medium.u.hGlobal.0);
        let count = DragQueryFileW(drop, u32::MAX, None);
        let paths = (0..count)
            .filter_map(|index| {
                let length = DragQueryFileW(drop, index, None) as usize;
                let mut buffer = vec![0u16; length + 1];
                let copied = DragQueryFileW(drop, index, Some(&mut buffer)) as usize;
                (copied > 0).then(|| PathBuf::from(OsString::from_wide(&buffer[..copied])))
            })
            .collect();
        ReleaseStgMedium(&mut medium);
        Ok(paths)
    }
}

fn launch(action: &str, paths: &[PathBuf]) -> std::io::Result<()> {
    let app = app_path().ok_or(std::io::ErrorKind::NotFound)?;
    let mut rest = paths;
    while !rest.is_empty() {
        let mut length = 0;
        let take = rest
            .iter()
            .take_while(|path| {
                length += path.as_os_str().len() + 3;
                length < COMMAND_LIMIT
            })
            .count()
            .max(1);
        let mut command = std::process::Command::new(&app);
        command.arg(format!("--action={action}"));
        // All paths in one process: the app need not wait for others of a burst.
        if take == paths.len() {
            command.arg("--batch");
        }
        command.args(&rest[..take]).creation_flags(CREATE_NO_WINDOW);
        if let Some(folder) = app.parent() {
            command.current_dir(folder);
        }
        command.spawn()?;
        rest = &rest[take..];
    }
    Ok(())
}

#[implement(IShellExtInit, IContextMenu)]
#[derive(Default)]
struct ContextMenu {
    paths: RefCell<Vec<PathBuf>>,
    /// Actions in the order of the command ids handed out by `QueryContextMenu`.
    actions: RefCell<Vec<&'static str>>,
    icon: Cell<Option<HBITMAP>>,
}

impl Drop for ContextMenu {
    fn drop(&mut self) {
        if let Some(bitmap) = self.icon.take() {
            unsafe {
                let _ = DeleteObject(bitmap.into());
            }
        }
    }
}

impl IShellExtInit_Impl for ContextMenu_Impl {
    fn Initialize(&self, _folder: *const ITEMIDLIST, data: Ref<'_, IDataObject>, _key: HKEY) -> windows_core::Result<()> {
        let data = data.ok()?;
        *self.paths.borrow_mut() = selected_paths(data)?;
        Ok(())
    }
}

impl IContextMenu_Impl for ContextMenu_Impl {
    fn QueryContextMenu(&self, menu: HMENU, position: u32, first: u32, last: u32, flags: u32) -> HRESULT {
        if flags & CMF_DEFAULTONLY != 0 {
            return HRESULT(0);
        }
        let items: Vec<Selected> = self
            .paths
            .borrow()
            .iter()
            .map(|path| Selected { path: path.clone(), is_dir: path.is_dir() })
            .collect();
        let groups = menu::build(&items, &|path| path.exists());
        if groups.is_empty() {
            return HRESULT(0);
        }
        if self.icon.get().is_none() {
            self.icon.set(icon_bitmap());
        }
        let mut actions = self.actions.borrow_mut();
        actions.clear();
        let mut at = position;
        let separator = |at: &mut u32| unsafe {
            if InsertMenuW(menu, *at, MF_BYPOSITION | MF_SEPARATOR, 0, PCWSTR::null()).is_ok() {
                *at += 1;
            }
        };
        for group in groups {
            separator(&mut at);
            for entry in group {
                let id = first + actions.len() as u32;
                if id > last {
                    break;
                }
                let label = wide(&entry.label);
                unsafe {
                    if InsertMenuW(menu, at, MF_BYPOSITION | MF_STRING, id as usize, PCWSTR(label.as_ptr())).is_err() {
                        continue;
                    }
                    if let Some(bitmap) = self.icon.get() {
                        let info = MENUITEMINFOW {
                            cbSize: std::mem::size_of::<MENUITEMINFOW>() as u32,
                            fMask: MIIM_BITMAP,
                            hbmpItem: bitmap,
                            ..Default::default()
                        };
                        let _ = SetMenuItemInfoW(menu, at, true, &info);
                    }
                }
                at += 1;
                actions.push(entry.action);
            }
        }
        separator(&mut at);
        // Success code = number of command ids used.
        HRESULT(actions.len() as i32)
    }

    fn InvokeCommand(&self, info: *const CMINVOKECOMMANDINFO) -> windows_core::Result<()> {
        let info = unsafe { info.as_ref() }.ok_or(E_POINTER)?;
        // A small number is the command's offset; a pointer is a verb name, which we have none of.
        let offset = info.lpVerb.0 as usize;
        if offset > u16::MAX as usize {
            return Err(E_INVALIDARG.into());
        }
        let action = *self.actions.borrow().get(offset).ok_or(E_INVALIDARG)?;
        launch(action, &self.paths.borrow()).map_err(|_| E_FAIL.into())
    }

    fn GetCommandString(&self, _id: usize, _kind: u32, _reserved: *const u32, _name: PSTR, _size: u32) -> windows_core::Result<()> {
        Err(E_NOTIMPL.into())
    }
}

#[implement(IClassFactory)]
struct Factory;

impl IClassFactory_Impl for Factory_Impl {
    fn CreateInstance(&self, outer: Ref<'_, IUnknown>, iid: *const GUID, object: *mut *mut c_void) -> windows_core::Result<()> {
        if !outer.is_null() {
            return Err(CLASS_E_NOAGGREGATION.into());
        }
        let menu: IUnknown = ContextMenu::default().into();
        unsafe { menu.query(iid, object).ok() }
    }

    fn LockServer(&self, _lock: BOOL) -> windows_core::Result<()> {
        Ok(())
    }
}

/// # Safety
/// Called by COM with valid pointers.
#[no_mangle]
pub unsafe extern "system" fn DllGetClassObject(class: *const GUID, iid: *const GUID, object: *mut *mut c_void) -> HRESULT {
    if class.is_null() || iid.is_null() || object.is_null() {
        return E_POINTER;
    }
    *object = std::ptr::null_mut();
    if *class != CLSID_MENU {
        return CLASS_E_CLASSNOTAVAILABLE;
    }
    let factory: IUnknown = Factory.into();
    factory.query(iid, object)
}

/// Stays loaded until Explorer exits.
#[no_mangle]
pub extern "system" fn DllCanUnloadNow() -> HRESULT {
    S_FALSE
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::System::Com::{CoInitializeEx, CoTaskMemFree, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::{BHID_DataObject, IShellItemArray, SHCreateShellItemArrayFromIDLists, SHParseDisplayName};
    use windows::Win32::UI::WindowsAndMessaging::{CreatePopupMenu, DestroyMenu, GetMenuItemCount, GetMenuStringW};

    /// Drives the object the way Explorer does, without registering anything.
    #[test]
    fn builds_a_menu_for_a_real_file() {
        let folder = std::env::temp_dir().join(format!("silk-zip-shell-test-{}", std::process::id()));
        std::fs::create_dir_all(&folder).unwrap();
        let archive = folder.join("sample.zip");
        std::fs::write(&archive, b"PK").unwrap();
        unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            let name = wide(&archive);
            let mut list: *mut ITEMIDLIST = std::ptr::null_mut();
            SHParseDisplayName(PCWSTR(name.as_ptr()), None, &mut list, 0, None).unwrap();
            let array: IShellItemArray = SHCreateShellItemArrayFromIDLists(&[list.cast_const()]).unwrap();
            let data: IDataObject = array.BindToHandler(None, &BHID_DataObject).unwrap();
            CoTaskMemFree(Some(list.cast()));

            let mut raw = std::ptr::null_mut();
            DllGetClassObject(&CLSID_MENU, &IClassFactory::IID, &mut raw).ok().unwrap();
            let factory = IClassFactory::from_raw(raw);
            let init: IShellExtInit = factory.CreateInstance(None).unwrap();
            init.Initialize(None, &data, Some(HKEY::default())).unwrap();
            let context: IContextMenu = init.cast().unwrap();
            let menu = CreatePopupMenu().unwrap();
            let _ = context.QueryContextMenu(menu, 0, 1, 0x7fff, 0);
            let labels: Vec<String> = (0..GetMenuItemCount(Some(menu)))
                .filter_map(|index| {
                    let mut buffer = [0u16; 256];
                    let length = GetMenuStringW(menu, index as u32, Some(&mut buffer), MF_BYPOSITION);
                    (length > 0).then(|| String::from_utf16_lossy(&buffer[..length as usize]))
                })
                .collect();
            let _ = DestroyMenu(menu);
            assert_eq!(labels.len(), 4, "{labels:?}");
            assert!(labels.contains(&"\"sample\" 폴더에 풀기(&E)".to_string()), "{labels:?}");
        }
        std::fs::remove_dir_all(&folder).unwrap();
    }
}
