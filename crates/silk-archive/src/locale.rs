//! libarchive and the 7-Zip SDK convert names through the C locale. A GUI app
//! (and a bare CI shell) starts in the "C" locale, where any non-ASCII name fails
//! to convert, so switch character handling to UTF-8 once.

#[cfg(windows)]
pub(crate) fn ensure_utf8() {}

#[cfg(not(windows))]
pub(crate) fn ensure_utf8() {
    use std::sync::Once;
    static ONCE: Once = Once::new();
    unsafe extern "C" {
        fn setlocale(category: i32, locale: *const std::ffi::c_char) -> *const std::ffi::c_char;
    }
    #[cfg(target_os = "macos")]
    const LC_CTYPE: i32 = 2;
    #[cfg(not(target_os = "macos"))]
    const LC_CTYPE: i32 = 0;
    ONCE.call_once(|| unsafe {
        for name in [c"UTF-8", c"C.UTF-8", c"en_US.UTF-8"] {
            if !setlocale(LC_CTYPE, name.as_ptr()).is_null() {
                break;
            }
        }
    });
}
