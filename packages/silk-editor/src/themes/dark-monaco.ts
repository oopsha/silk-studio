import type { Monaco } from "@monaco-editor/react";
import {
  resolveEffectiveColorTheme,
  type ColorThemeId,
} from "@silk-studio/ui/platform/colorTheme.ts";

export type WorkbenchColorThemeId = ColorThemeId;

export const DARK_MONACO_THEME = "dark";
export const LIGHT_MONACO_THEME = "light";

export function defineDarkMonacoTheme(monaco: Monaco) {
  monaco.editor.defineTheme(DARK_MONACO_THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#121314",
      "editor.foreground": "#bbbebf",
      "editorLineNumber.foreground": "#858889",
      "editorLineNumber.activeForeground": "#bbbebf",
      "editorCursor.foreground": "#bbbebf",
      "editor.selectionBackground": "#276782dd",
      "editor.lineHighlightBackground": "#242526",
      "editorGutter.background": "#121314",
      "scrollbar.shadow": "#191b1d4d",
      "scrollbarSlider.background": "#a8a9aa85",
      "scrollbarSlider.hoverBackground": "#a8a9aa90",
      "scrollbarSlider.activeBackground": "#a8a9aa9c",
      "minimapSlider.background": "#a8a9aa40",
      "minimapSlider.hoverBackground": "#a8a9aa60",
      "minimapSlider.activeBackground": "#a8a9aa80",
    },
  });
}

/** VS Code 2026-light.json's editor.* colors — see defineDarkMonacoTheme for the dark side. */
export function defineLightMonacoTheme(monaco: Monaco) {
  monaco.editor.defineTheme(LIGHT_MONACO_THEME, {
    base: "vs",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#ffffff",
      "editor.foreground": "#202020",
      "editorLineNumber.foreground": "#606060",
      "editorLineNumber.activeForeground": "#202020",
      "editorCursor.foreground": "#202020",
      "editor.selectionBackground": "#0069cc40",
      "editor.lineHighlightBackground": "#eaeaea40",
      "editorGutter.background": "#ffffff",
      "scrollbar.shadow": "#00000000",
      "scrollbarSlider.background": "#646464c0",
      "scrollbarSlider.hoverBackground": "#646464d0",
      "scrollbarSlider.activeBackground": "#646464e0",
      "minimapSlider.background": "#64646440",
      "minimapSlider.hoverBackground": "#64646460",
      "minimapSlider.activeBackground": "#64646480",
    },
  });
}

export function defineWorkbenchMonacoThemes(monaco: Monaco) {
  defineDarkMonacoTheme(monaco);
  defineLightMonacoTheme(monaco);
}

export function monacoThemeForColorTheme(
  colorTheme: WorkbenchColorThemeId,
): string {
  return resolveEffectiveColorTheme(colorTheme) === "light"
    ? LIGHT_MONACO_THEME
    : DARK_MONACO_THEME;
}
