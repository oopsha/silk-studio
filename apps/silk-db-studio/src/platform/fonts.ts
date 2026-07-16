export type WorkbenchPlatform = "windows" | "mac" | "linux";

export function detectWorkbenchPlatform(): WorkbenchPlatform {
  const ua = navigator.userAgent;
  if (/Macintosh|Mac OS X/i.test(ua)) {
    return "mac";
  }
  if (/Linux/i.test(ua)) {
    return "linux";
  }
  return "windows";
}

/** VS Code `.monaco-workbench.{windows|mac|linux}` platform classes */
export function applyWorkbenchFonts(): WorkbenchPlatform {
  const platform = detectWorkbenchPlatform();
  const root = document.documentElement;
  root.classList.add(`platform-${platform}`);
  return platform;
}
