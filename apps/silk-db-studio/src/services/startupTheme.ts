import { invoke, isTauri } from "@tauri-apps/api/core";

type StartupTheme = {
  backgroundColor: string;
  foregroundColor: string;
  hoverBackground: string;
  pressedBackground: string;
};

/**
 * Saves the already-applied CSS theme for Rust to use before the WebView is ready next launch.
 * This mirrors VS Code's persisted startup background and deliberately stores only colors.
 */
export async function saveStartupTheme(): Promise<void> {
  if (!isTauri()) return;

  const theme: StartupTheme =
    document.documentElement.dataset.colorTheme === "light"
      ? {
          backgroundColor: "#fafafd",
          foregroundColor: "#606060",
          hoverBackground: "#e3e3e5",
          pressedBackground: "#d6d6d8",
        }
      : {
          backgroundColor: "#191a1b",
          foregroundColor: "#8c8c8c",
          hoverBackground: "#323233",
          pressedBackground: "#3c3c3d",
        };
  try {
    await invoke("startup_theme_save", { theme });
  } catch (error) {
    console.warn("[startup-theme] failed to save startup colors", error);
  }
}
