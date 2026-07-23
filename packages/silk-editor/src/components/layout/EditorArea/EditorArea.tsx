import { useCallback, useEffect, useRef } from "react";
import { Editor } from "@monaco-editor/react";
import type { Monaco } from "@monaco-editor/react";
import type { IDisposable, editor } from "monaco-editor";
import { getEditorFontFamily } from "@silk-studio/ui/platform/fontDefaults.ts";
import { EditorService } from "../../../services/editor/editorService";
import { EditorStatusService } from "../../../services/editor/editorStatusService";
import { useActiveEditor } from "../../../services/editor/useActiveEditor";
import type { EditorTab } from "../../../services/editor/editorTypes";
import {
  defineWorkbenchMonacoThemes,
  monacoThemeForColorTheme,
  type WorkbenchColorThemeId,
} from "../../../themes/dark2026-monaco";
import "./EditorArea.css";

export type EditorConfigurationOptions = {
  colorTheme: WorkbenchColorThemeId;
  fontSize: number;
  tabSize: number;
  insertSpaces: boolean;
  lineNumbers: "on" | "off" | "relative";
  minimapEnabled: boolean;
  wordWrap: "off" | "on";
};

type EditorAreaProps = {
  onRunQuery?: () => void;
  renderAlternative?: (tab: EditorTab) => React.ReactNode | null;
  configuration: EditorConfigurationOptions;
  /** Extra Monaco setup (language registration, providers) before the first editor mounts. */
  beforeMount?: (monaco: Monaco) => void;
};

function EditorArea({
  onRunQuery,
  renderAlternative,
  configuration,
  beforeMount,
}: EditorAreaProps) {
  const activeTab = useActiveEditor();
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const cursorListenerRef = useRef<IDisposable | null>(null);

  const handleEditorWillMount = useCallback(
    (monaco: Monaco) => {
      defineWorkbenchMonacoThemes(monaco);
      beforeMount?.(monaco);
    },
    [beforeMount],
  );

  const handleMount = useCallback(
    (instance: editor.IStandaloneCodeEditor, monaco: Monaco) => {
      editorRef.current = instance;
      EditorService.setActiveTextEditor(instance);
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

      if (onRunQuery) {
        instance.addCommand(
          monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
          onRunQuery,
        );
      }
    },
    [onRunQuery],
  );

  useEffect(() => {
    if (!activeTab) {
      EditorStatusService.resetCursorPosition();
    }
  }, [activeTab]);

  useEffect(() => {
    const instance = editorRef.current;
    if (!instance) return;

    instance.updateOptions({
      fontSize: configuration.fontSize,
      tabSize: configuration.tabSize,
      insertSpaces: configuration.insertSpaces,
      lineNumbers: configuration.lineNumbers,
      minimap: { enabled: configuration.minimapEnabled },
      wordWrap: configuration.wordWrap,
    });
  }, [configuration]);

  useEffect(() => {
    return () => {
      cursorListenerRef.current?.dispose();
      cursorListenerRef.current = null;
      if (editorRef.current) {
        EditorService.setActiveTextEditor(null);
        editorRef.current = null;
      }
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

  const alternative = renderAlternative?.(activeTab);
  if (alternative) {
    return <main className="editor-area">{alternative}</main>;
  }

  return (
    <main className="editor-area">
      <Editor
        key={activeTab.id}
        height="100%"
        language={activeTab.languageId}
        value={activeTab.content}
        theme={monacoThemeForColorTheme(configuration.colorTheme)}
        beforeMount={handleEditorWillMount}
        onMount={handleMount}
        onChange={handleChange}
        options={{
          fontFamily: getEditorFontFamily(),
          fontSize: configuration.fontSize,
          tabSize: configuration.tabSize,
          insertSpaces: configuration.insertSpaces,
          lineNumbers: configuration.lineNumbers,
          renderLineHighlight: "line",
          minimap: { enabled: configuration.minimapEnabled },
          wordWrap: configuration.wordWrap,
          suggestOnTriggerCharacters: true,
          quickSuggestions: { other: true, comments: false, strings: false },
          wordBasedSuggestions: "off",
          scrollBeyondLastLine: false,
          automaticLayout: true,
        }}
      />
    </main>
  );
}

export default EditorArea;
