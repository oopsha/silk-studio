import { Editor } from "@monaco-editor/react";
import type { Monaco } from "@monaco-editor/react";
import {
  getEditorFontFamily,
  getEditorFontSize,
} from "../../../platform/fontDefaults";
import {
  DARK_2026_MONACO_THEME,
  defineDark2026MonacoTheme,
} from "../../../themes/dark2026-monaco";
import "./EditorArea.css";

function handleEditorWillMount(monaco: Monaco) {
  defineDark2026MonacoTheme(monaco);
}

function EditorArea() {
  return (
    <main className="editor-area">
      <Editor
        height="100%"
        defaultLanguage="plaintext"
        theme={DARK_2026_MONACO_THEME}
        beforeMount={handleEditorWillMount}
        options={{
          fontFamily: getEditorFontFamily(),
          fontSize: getEditorFontSize(),
          renderLineHighlight: "none",
        }}
      />
    </main>
  );
}

export default EditorArea;
