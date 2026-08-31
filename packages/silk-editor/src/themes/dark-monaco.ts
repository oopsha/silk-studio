import type { Monaco } from "@monaco-editor/react";

export type WorkbenchColorThemeId = "dark" | "light";

export const DARK_MONACO_THEME = "dark";

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

export function defineWorkbenchMonacoThemes(monaco: Monaco) {
  defineDarkMonacoTheme(monaco);
}

export function monacoThemeForColorTheme(
  colorTheme: WorkbenchColorThemeId,
): string {
  // No light-mode Monaco theme defined yet (see colorThemes.ts) — falls back to
  // dark until that work lands.
  void colorTheme;
  return DARK_MONACO_THEME;
}
