//! Opens archives on double-click for the Store package (`DelegateExecute`). The package's folder
//! changes with every update, so its file associations cannot name `silk-zip.exe`; they name this
//! class instead, which the package manifest declares. Nothing here may panic.
use crate::com::launch;
use std::cell::RefCell;
use std::ffi::c_void;
use windows::Win32::Foundation::{E_FAIL, E_POINTER, POINT};
use windows::Win32::UI::Shell::{
    IExecuteCommand, IExecuteCommand_Impl, IObjectWithSelection, IObjectWithSelection_Impl, IShellItemArray,
};
use windows::Win32::UI::WindowsAndMessaging::{AllowSetForegroundWindow, ASFW_ANY};
use windows_core::{implement, Interface, Ref, BOOL, GUID, PCWSTR};

#[implement(IExecuteCommand, IObjectWithSelection)]
#[derive(Default)]
pub(crate) struct Open {
    selection: RefCell<Option<IShellItemArray>>,
}

impl IObjectWithSelection_Impl for Open_Impl {
    fn SetSelection(&self, items: Ref<'_, IShellItemArray>) -> windows_core::Result<()> {
        *self.selection.borrow_mut() = items.as_ref().cloned();
        Ok(())
    }

    fn GetSelection(&self, iid: *const GUID, object: *mut *mut c_void) -> windows_core::Result<()> {
        let selection = self.selection.borrow();
        let items = selection.as_ref().ok_or(E_FAIL)?;
        if iid.is_null() || object.is_null() {
            return Err(E_POINTER.into());
        }
        unsafe { items.query(iid, object).ok() }
    }
}

impl IExecuteCommand_Impl for Open_Impl {
    fn SetKeyState(&self, _state: u32) -> windows_core::Result<()> {
        Ok(())
    }

    fn SetParameters(&self, _parameters: &PCWSTR) -> windows_core::Result<()> {
        Ok(())
    }

    fn SetPosition(&self, _point: &POINT) -> windows_core::Result<()> {
        Ok(())
    }

    fn SetShowWindow(&self, _show: i32) -> windows_core::Result<()> {
        Ok(())
    }

    fn SetNoShowUI(&self, _no_ui: BOOL) -> windows_core::Result<()> {
        Ok(())
    }

    fn SetDirectory(&self, _directory: &PCWSTR) -> windows_core::Result<()> {
        Ok(())
    }

    fn Execute(&self) -> windows_core::Result<()> {
        let paths = crate::command::paths_of(self.selection.borrow().as_ref());
        if paths.is_empty() {
            return Err(E_FAIL.into());
        }
        // This process is a COM surrogate; let the app it starts come to the front.
        unsafe {
            let _ = AllowSetForegroundWindow(ASFW_ANY);
        }
        // One process per archive, as the command line registration does.
        for path in paths {
            launch("open", std::slice::from_ref(&path)).map_err(|_| E_FAIL)?;
        }
        Ok(())
    }
}
