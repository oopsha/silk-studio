import type { WorkbenchPlatform } from "./fonts";
import { detectWorkbenchPlatform } from "./fonts";

const UI_FONT_FAMILY: Record<WorkbenchPlatform, string> = {
  windows: '"Segoe WPC", "Segoe UI", sans-serif',
  mac: "-apple-system, BlinkMacSystemFont, sans-serif",
  linux: 'system-ui, "Ubuntu", "Droid Sans", sans-serif',
};

const UI_FONT_FAMILY_KO: Record<WorkbenchPlatform, string> = {
  windows: '"Segoe WPC", "Segoe UI", "Malgun Gothic", "Dotom", sans-serif',
  mac: '-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Nanum Gothic", "AppleGothic", sans-serif',
  linux:
    'system-ui, "Ubuntu", "Droid Sans", "Source Han Sans K", "Source Han Sans JR", "Source Han Sans", "UnDotum", "FBaekmuk Gulim", sans-serif',
};

const EDITOR_FONT_FAMILY: Record<WorkbenchPlatform, string> = {
  windows: "Consolas, 'Courier New', monospace",
  mac: "Menlo, Monaco, 'Courier New', monospace",
  linux:
    "'Droid Sans Mono', 'Ubuntu Mono', 'Liberation Mono', 'DejaVu Sans Mono', 'Courier New', monospace",
};

const EDITOR_FONT_SIZE: Record<WorkbenchPlatform, number> = {
  windows: 14,
  mac: 12,
  linux: 14,
};

function resolvePlatform(): WorkbenchPlatform {
  const root = document.documentElement;
  if (root.classList.contains("platform-mac")) return "mac";
  if (root.classList.contains("platform-linux")) return "linux";
  if (root.classList.contains("platform-windows")) return "windows";
  return detectWorkbenchPlatform();
}

function useKoreanUiFont(): boolean {
  return document.documentElement.lang.toLowerCase().startsWith("ko");
}

export function getUiFontFamily(platform = resolvePlatform()): string {
  return useKoreanUiFont()
    ? UI_FONT_FAMILY_KO[platform]
    : UI_FONT_FAMILY[platform];
}

export function getEditorFontFamily(platform = resolvePlatform()): string {
  return EDITOR_FONT_FAMILY[platform];
}

export function getEditorFontSize(platform = resolvePlatform()): number {
  return EDITOR_FONT_SIZE[platform];
}
