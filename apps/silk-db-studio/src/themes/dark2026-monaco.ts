import type { Monaco } from "@monaco-editor/react";

export const DARK_2026_MONACO_THEME = "dark-2026";

export function defineDark2026MonacoTheme(monaco: Monaco) {
  monaco.editor.defineTheme(DARK_2026_MONACO_THEME, {
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
