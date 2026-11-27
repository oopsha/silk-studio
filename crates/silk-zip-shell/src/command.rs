//! The Windows 11 first-level menu: a "Silk Zip" entry with the same items as the classic menu as
//! its sub-menu. It is reached through the package the app registers (`shell_menu.rs`), so it
//! runs in a COM surrogate rather than in Explorer. Nothing here may panic.
use crate::com::{app_path, language, launch};
use silk_zip_menu::{self as menu, Lang, Selected};
use std::cell::{Cell, RefCell};
use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;
use std::path::PathBuf;
use windows::Win32::Foundation::{E_FAIL, E_NOTIMPL, E_POINTER, S_FALSE, S_OK};
use windows::Win32::System::Com::{CoTaskMemFree, IBindCtx};
use windows::Win32::UI::Shell::{
    IEnumExplorerCommand, IEnumExplorerCommand_Impl, IExplorerCommand, IExplorerCommand_Impl, IShellItemArray, SHStrDupW,
    ECF_DEFAULT, ECF_HASSUBCOMMANDS, ECF_SEPARATORBEFORE, ECS_ENABLED, ECS_HIDDEN, SIGDN_FILESYSPATH,
};
use windows_core::{implement, Ref, BOOL, GUID, HRESULT, PCWSTR, PWSTR};

/// The modern menu has no keyboard letters: "압축 풀기(&T)..." -> "압축 풀기...".
pub(crate) fn plain_label(label: &str) -> String {
    let mut text = label.to_string();
    if let Some(start) = text.rfind("(&") {
        let rest: Vec<char> = text[start + 2..].chars().take(2).collect();
        if let [key, ')'] = rest[..] {
            text.replace_range(start..start + 2 + key.len_utf8() + 1, "");
        }
    }
    text.replace("&&", "&")
}

fn text(value: &str) -> windows_core::Result<PWSTR> {
    let wide: Vec<u16> = value.encode_utf16().chain(Some(0)).collect();
    unsafe { SHStrDupW(PCWSTR(wide.as_ptr())) }
}

fn icon() -> windows_core::Result<PWSTR> {
    match app_path() {
        Some(app) => text(&format!("{},0", app.display())),
        None => Err(E_NOTIMPL.into()),
    }
}

fn paths_of(items: Option<&IShellItemArray>) -> Vec<PathBuf> {
    let Some(items) = items else { return Vec::new() };
    let count = unsafe { items.GetCount() }.unwrap_or(0);
    (0..count)
        .filter_map(|index| unsafe {
            let name = items.GetItemAt(index).ok()?.GetDisplayName(SIGDN_FILESYSPATH).ok()?;
            let path = PathBuf::from(OsString::from_wide(name.as_wide()));
            CoTaskMemFree(Some(name.0 as *const _));
            Some(path)
        })
        .collect()
}

/// The "실크집" / "Silk Zip" entry itself.
#[implement(IExplorerCommand)]
#[derive(Default)]
pub(crate) struct Root {
    /// The selection, remembered because the sub-menu is asked for without it.
    paths: RefCell<Vec<PathBuf>>,
}

impl Root_Impl {
    fn remember(&self, items: Ref<'_, IShellItemArray>) {
        let paths = paths_of(items.as_ref());
        if !paths.is_empty() {
            *self.paths.borrow_mut() = paths;
        }
    }
}

impl IExplorerCommand_Impl for Root_Impl {
    fn GetTitle(&self, items: Ref<'_, IShellItemArray>) -> windows_core::Result<PWSTR> {
        self.remember(items);
        text(match language() {
            Lang::Ko => "실크집",
            Lang::En => "Silk Zip",
        })
    }

    fn GetIcon(&self, _items: Ref<'_, IShellItemArray>) -> windows_core::Result<PWSTR> {
        icon()
    }

    fn GetToolTip(&self, _items: Ref<'_, IShellItemArray>) -> windows_core::Result<PWSTR> {
        Err(E_NOTIMPL.into())
    }

    fn GetCanonicalName(&self) -> windows_core::Result<GUID> {
        Ok(GUID::zeroed())
    }

    fn GetState(&self, items: Ref<'_, IShellItemArray>, _slow: BOOL) -> windows_core::Result<u32> {
        self.remember(items);
        Ok(ECS_ENABLED.0 as u32)
    }

    fn Invoke(&self, _items: Ref<'_, IShellItemArray>, _context: Ref<'_, IBindCtx>) -> windows_core::Result<()> {
        Ok(())
    }

    fn GetFlags(&self) -> windows_core::Result<u32> {
        Ok(ECF_HASSUBCOMMANDS.0 as u32)
    }

    fn EnumSubCommands(&self) -> windows_core::Result<IEnumExplorerCommand> {
        let paths = self.paths.borrow().clone();
        let items: Vec<Selected> = paths.iter().map(|path| Selected { path: path.clone(), is_dir: path.is_dir() }).collect();
        let mut commands: Vec<IExplorerCommand> = Vec::new();
        for (group_index, group) in menu::build(&items, &|path| path.exists(), language()).into_iter().enumerate() {
            for (index, entry) in group.into_iter().enumerate() {
                let child = Child {
                    title: plain_label(&entry.label),
                    action: entry.action,
                    paths: paths.clone(),
                    separator: group_index > 0 && index == 0,
                };
                commands.push(child.into());
            }
        }
        Ok(Children { commands, next: Cell::new(0) }.into())
    }
}

#[implement(IExplorerCommand)]
struct Child {
    title: String,
    action: &'static str,
    paths: Vec<PathBuf>,
    separator: bool,
}

impl IExplorerCommand_Impl for Child_Impl {
    fn GetTitle(&self, _items: Ref<'_, IShellItemArray>) -> windows_core::Result<PWSTR> {
        text(&self.title)
    }

    fn GetIcon(&self, _items: Ref<'_, IShellItemArray>) -> windows_core::Result<PWSTR> {
        icon()
    }

    fn GetToolTip(&self, _items: Ref<'_, IShellItemArray>) -> windows_core::Result<PWSTR> {
        Err(E_NOTIMPL.into())
    }

    fn GetCanonicalName(&self) -> windows_core::Result<GUID> {
        Ok(GUID::zeroed())
    }

    fn GetState(&self, _items: Ref<'_, IShellItemArray>, _slow: BOOL) -> windows_core::Result<u32> {
        Ok(if self.paths.is_empty() { ECS_HIDDEN.0 } else { ECS_ENABLED.0 } as u32)
    }

    fn Invoke(&self, _items: Ref<'_, IShellItemArray>, _context: Ref<'_, IBindCtx>) -> windows_core::Result<()> {
        launch(self.action, &self.paths).map_err(|_| E_FAIL.into())
    }

    fn GetFlags(&self) -> windows_core::Result<u32> {
        Ok(if self.separator { ECF_SEPARATORBEFORE.0 } else { ECF_DEFAULT.0 } as u32)
    }

    fn EnumSubCommands(&self) -> windows_core::Result<IEnumExplorerCommand> {
        Err(E_NOTIMPL.into())
    }
}

#[implement(IEnumExplorerCommand)]
struct Children {
    commands: Vec<IExplorerCommand>,
    next: Cell<usize>,
}

impl IEnumExplorerCommand_Impl for Children_Impl {
    fn Next(&self, count: u32, out: *mut Option<IExplorerCommand>, fetched: *mut u32) -> HRESULT {
        if out.is_null() {
            return E_POINTER;
        }
        let mut done = 0u32;
        while done < count {
            let Some(command) = self.commands.get(self.next.get()) else { break };
            unsafe { out.add(done as usize).write(Some(command.clone())) };
            self.next.set(self.next.get() + 1);
            done += 1;
        }
        if !fetched.is_null() {
            unsafe { fetched.write(done) };
        }
        if done == count {
            S_OK
        } else {
            S_FALSE
        }
    }

    fn Skip(&self, count: u32) -> windows_core::Result<()> {
        self.next.set((self.next.get() + count as usize).min(self.commands.len()));
        Ok(())
    }

    fn Reset(&self) -> windows_core::Result<()> {
        self.next.set(0);
        Ok(())
    }

    fn Clone(&self) -> windows_core::Result<IEnumExplorerCommand> {
        Ok(Children { commands: self.commands.clone(), next: Cell::new(self.next.get()) }.into())
    }
}

#[cfg(test)]
mod tests {
    use super::plain_label;

    #[test]
    fn keyboard_letters_are_removed() {
        assert_eq!(plain_label("여기에 풀기(&X)"), "여기에 풀기");
        assert_eq!(plain_label("Silk Zip으로 압축 풀기(&T)..."), "Silk Zip으로 압축 풀기...");
        assert_eq!(plain_label("\"A&&B\" 폴더에 풀기(&E)"), "\"A&B\" 폴더에 풀기");
    }
}
