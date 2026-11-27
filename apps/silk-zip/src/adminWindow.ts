import { detectWorkbenchPlatform } from "@silk-studio/ui/platform/fonts.ts";

/**
 * Administrator windows exist only on Windows, and not in the Store build: a packaged app cannot
 * elevate. The native side sets the flag before the page's scripts run (src-tauri/src/lib.rs).
 */
export const canOpenAdminWindow =
  detectWorkbenchPlatform() === "windows" && !(globalThis as { __SILK_ZIP_STORE__?: boolean }).__SILK_ZIP_STORE__;
