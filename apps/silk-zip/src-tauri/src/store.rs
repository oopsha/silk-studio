//! Whether this process runs from the Microsoft Store package (`apps/silk-zip/store`). There the
//! package declares the Explorer menu, so the app must not register it, and its install folder
//! changes with every update.

/// The package's `Identity Name`; keep equal to the one in `store/AppxManifest.xml`.
#[cfg(windows)]
const PACKAGE_PREFIX: &str = "SilkStudio.SilkZip_";

#[cfg(windows)]
pub fn is_packaged() -> bool {
    use windows::Win32::Storage::Packaging::Appx::GetCurrentPackageFullName;
    let mut buffer = [0u16; 256];
    let mut length = buffer.len() as u32;
    let status = unsafe { GetCurrentPackageFullName(&mut length, Some(windows::core::PWSTR(buffer.as_mut_ptr()))) };
    status.is_ok() && String::from_utf16_lossy(&buffer).starts_with(PACKAGE_PREFIX)
}
