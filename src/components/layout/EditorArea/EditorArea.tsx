import { useCallback, useEffect, useRef } from "react";
import { Editor } from "@monaco-editor/react";
import type { Monaco } from "@monaco-editor/react";
import type { IDisposable, editor } from "monaco-editor";
import {
  getEditorFontFamily,
  getEditorFontSize,
} from "../../../platform/fontDefaults";
import { EditorService } from "../../../services/editor/editorService";
import { EditorStatusService } from "../../../services/editor/editorStatusService";
import { useActiveEditor } from "../../../services/editor/useActiveEditor";
import {
  DARK_2026_MONACO_THEME,
  defineDark2026MonacoTheme,
} from "../../../themes/dark2026-monaco";
import "./EditorArea.css";

function handleEditorWillMount(monaco: Monaco) {
  defineDark2026MonacoTheme(monaco);
}

function EditorArea() {
  const activeTab = useActiveEditor();
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const cursorListenerRef = useRef<IDisposable | null>(null);

  const handleMount = useCallback((instance: editor.IStandaloneCodeEditor) => {
    editorRef.current = instance;
    cursorListenerRef.current?.dispose();

    const position = instance.getPosition();
    EditorStatusService.setCursorPosition(
      position?.lineNumber ?? 1,
      position?.column ?? 1,
    );

    cursorListenerRef.current = instance.onDidChangeCursorPosition((event) => {
      EditorStatusService.setCursorPosition(
        event.position.lineNumber,
        event.position.column,
      );
    });
  }, []);

  useEffect(() => {
    if (!activeTab) {
      EditorStatusService.resetCursorPosition();
    }
  }, [activeTab]);

  useEffect(() => {
    return () => {
      cursorListenerRef.current?.dispose();
      cursorListenerRef.current = null;
      EditorStatusService.resetCursorPosition();
    };
  }, []);

  const handleChange = useCallback(
    (value: string | undefined) => {
      if (!activeTab || value === undefined) return;
      EditorService.updateTabContent(activeTab.id, value);
    },
    [activeTab],
  );

  if (!activeTab) {
    return <main className="editor-area editor-area--empty" />;
  }

  return (
    <main className="editor-area">
      <Editor
        key={activeTab.id}
        height="100%"
        language={activeTab.languageId}
        value={activeTab.content}
        theme={DARK_2026_MONACO_THEME}
        beforeMount={handleEditorWillMount}
        onMount={handleMount}
        onChange={handleChange}
        options={{
          fontFamily: getEditorFontFamily(),
          fontSize: getEditorFontSize(),
          renderLineHighlight: "line",
          minimap: { enabled: true },
          scrollBeyondLastLine: false,
          automaticLayout: true,
        }}
      />
    </main>
  );
}

export default EditorArea;
