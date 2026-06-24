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
    },
  });
}
