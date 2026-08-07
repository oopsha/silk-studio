import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { Editor } from "@monaco-editor/react";
import type { Monaco } from "@monaco-editor/react";
import type { IDisposable, editor } from "monaco-editor";
import { getEditorFontFamily } from "@silk-studio/ui/platform/fontDefaults.ts";
import { EditorGroupsService } from "../../../services/editor/editorGroupsService";
import type { EditorGroupId } from "../../../services/editor/editorGroupTypes";
import { EditorStatusService } from "../../../services/editor/editorStatusService";
import { useActiveEditor } from "../../../services/editor/useActiveEditor";
import type { EditorTab } from "../../../services/editor/editorTypes";
import {
  monacoModelPathForTab,
  scheduleRestoreViewState,
} from "../../../services/editor/monacoModelPath";
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
  stickyScrollEnabled: boolean;
  wordWrap: "off" | "on";
};

type EditorAreaProps = {
  /** Which editor group this instance renders — one Monaco instance per group. */
  groupId: EditorGroupId;
  /** Gates the shared cursor-position status bar so an unfocused pane can't stomp it. */
  isFocusedGroup: boolean;
  onRunQuery?: () => void;
  /** Execute Script (Ctrl+Shift+Enter) — whole buffer or selection with GO batches. */
  onRunScript?: () => void;
  renderAlternative?: (tab: EditorTab) => React.ReactNode | null;
  configuration: EditorConfigurationOptions;
  /** Extra Monaco setup (language registration, providers) before the first editor mounts. */
  beforeMount?: (monaco: Monaco) => void;
};

function EditorArea({
  groupId,
  isFocusedGroup,
  onRunQuery,
  onRunScript,
  renderAlternative,
  configuration,
  beforeMount,
}: EditorAreaProps) {
  const group = EditorGroupsService.getGroup(groupId);
  const activeTab = useActiveEditor(groupId);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const cursorListenerRef = useRef<IDisposable | null>(null);
  const isFocusedGroupRef = useRef(isFocusedGroup);
  isFocusedGroupRef.current = isFocusedGroup;

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
      group.setActiveTextEditor(instance);

      const tabId = group.getActiveTabId();
      if (tabId) {
        scheduleRestoreViewState(instance, () => group.getViewState(tabId));
      }

      cursorListenerRef.current?.dispose();

      if (isFocusedGroupRef.current) {
        const position = instance.getPosition();
        EditorStatusService.setCursorPosition(
          position?.lineNumber ?? 1,
          position?.column ?? 1,
        );
      }

      cursorListenerRef.current = instance.onDidChangeCursorPosition((event) => {
        if (!isFocusedGroupRef.current) return;
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
      if (onRunScript) {
        instance.addCommand(
          monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter,
          onRunScript,
        );
      }
    },
    [group, onRunQuery, onRunScript],
  );

  useEffect(() => {
    if (!activeTab && isFocusedGroup) {
      EditorStatusService.resetCursorPosition();
    }
  }, [activeTab, isFocusedGroup]);

  useLayoutEffect(() => {
    const tabId = activeTab?.id;
    return () => {
      const instance = editorRef.current;
      if (instance && tabId) {
        group.saveViewState(tabId, instance.saveViewState());
      }
    };
  }, [activeTab?.id, group]);

  // After tab switch, controlled `value` sync can reset scroll — restore after that.
  useEffect(() => {
    const instance = editorRef.current;
    const tabId = activeTab?.id;
    if (!instance || !tabId) return;
    scheduleRestoreViewState(instance, () => group.getViewState(tabId));
  }, [activeTab?.id, group]);

  useEffect(() => {
    const instance = editorRef.current;
    if (!instance) return;

    instance.updateOptions({
      fontSize: configuration.fontSize,
      tabSize: configuration.tabSize,
      insertSpaces: configuration.insertSpaces,
      lineNumbers: configuration.lineNumbers,
      minimap: { enabled: configuration.minimapEnabled },
      stickyScroll: { enabled: configuration.stickyScrollEnabled },
      wordWrap: configuration.wordWrap,
    });
  }, [configuration]);

  useEffect(() => {
    return () => {
      cursorListenerRef.current?.dispose();
      cursorListenerRef.current = null;
      if (editorRef.current) {
        group.setActiveTextEditor(null);
        editorRef.current = null;
      }
      if (isFocusedGroupRef.current) {
        EditorStatusService.resetCursorPosition();
      }
    };
  }, [group]);

  const handleChange = useCallback(
    (value: string | undefined) => {
      if (!activeTab || value === undefined) return;
      group.updateTabContent(activeTab.id, value);
    },
    [activeTab, group],
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
        height="100%"
        path={monacoModelPathForTab(activeTab)}
        language={activeTab.languageId}
        value={activeTab.content}
        theme={monacoThemeForColorTheme(configuration.colorTheme)}
        keepCurrentModel
        saveViewState
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
          stickyScroll: { enabled: configuration.stickyScrollEnabled },
          wordWrap: configuration.wordWrap,
          suggestOnTriggerCharacters: true,
          quickSuggestions: { other: true, comments: false, strings: false },
          wordBasedSuggestions: "off",
          scrollBeyondLastLine: false,
          automaticLayout: true,
          // Prefer workbench drops (explorer objects) over Monaco's default file drop.
          dropIntoEditor: { enabled: false },
        }}
      />
    </main>
  );
}

export default EditorArea;
