import { useCallback, useEffect, useState } from "react";
import { Editor } from "@monaco-editor/react";
import type { Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { getEditorFontFamily } from "@silk-studio/ui/platform/fontDefaults.ts";
import { CommandService } from "@silk-studio/workbench/platform/commands/commandService.ts";
import { useConfiguration } from "@silk-studio/workbench/platform/configuration/useConfiguration.ts";
import { EditorService } from "@silk-studio/editor/services/editor/editorService.ts";
import { useActiveEditor } from "@silk-studio/editor/services/editor/useActiveEditor.ts";
import {
  defineWorkbenchMonacoThemes,
  monacoThemeForColorTheme,
} from "@silk-studio/editor/themes/dark2026-monaco.ts";
import { bridgeFetchObjectDdl } from "../../services/connection/connectionDdlBridge";
import { formatErrorMessage } from "../../services/formatErrorMessage";
import {
  isPlsqlSourceLoaded,
  parsePlsqlEditorUri,
  PLSQL_SOURCE_LOADING,
} from "../../services/connection/plsqlEditorConstants";
import { getPlsqlSaveBlockedReason } from "../../services/connection/plsqlSaveService";
import { registerSqlLanguages } from "../../services/sql/registerSqlLanguages";
import "./PlsqlEditorView.css";

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string };

function PlsqlEditorView() {
  const activeTab = useActiveEditor();
  const ref = parsePlsqlEditorUri(activeTab?.uri);
  const configuration = useConfiguration();
  const readOnly = configuration["database.readOnly"];
  const [loadState, setLoadState] = useState<LoadState>({ status: "idle" });

  useEffect(() => {
    if (!ref || !activeTab) {
      setLoadState({ status: "error", message: "Invalid PL/SQL editor tab." });
      return;
    }

    if (isPlsqlSourceLoaded(activeTab.content)) {
      setLoadState({ status: "idle" });
      return;
    }

    let cancelled = false;
    setLoadState({ status: "loading" });

    void bridgeFetchObjectDdl(ref.schemaName, ref.objectName, ref.kind)
      .then((result) => {
        if (cancelled || !activeTab) return;
        const source = result.ddl.endsWith("\n") ? result.ddl : `${result.ddl}\n`;
        EditorService.setTabContentBaseline(activeTab.id, source);
        setLoadState({ status: "idle" });
      })
      .catch((error) => {
        if (cancelled) return;
        const message = formatErrorMessage(error, "Failed to load source.");
        const fallback = `-- Failed to load source\n-- ${message}\n`;
        EditorService.setTabContentBaseline(activeTab.id, fallback);
        setLoadState({ status: "error", message });
      });

    return () => {
      cancelled = true;
    };
  }, [
    ref?.profileId,
    ref?.schemaName,
    ref?.objectName,
    ref?.kind,
    activeTab?.id,
  ]);

  useEffect(() => {
    return () => {
      EditorService.setActiveTextEditor(null);
    };
  }, [activeTab?.id]);

  const handleBeforeMount = (monaco: Monaco) => {
    defineWorkbenchMonacoThemes(monaco);
    registerSqlLanguages(monaco);
  };

  const handleMount = useCallback((instance: editor.IStandaloneCodeEditor) => {
    EditorService.setActiveTextEditor(instance);
  }, []);

  const handleChange = useCallback(
    (value: string | undefined) => {
      if (!activeTab || value === undefined || readOnly) return;
      EditorService.updateTabContent(activeTab.id, value);
    },
    [activeTab, readOnly],
  );

  const content =
    activeTab?.content ??
    (loadState.status === "error"
      ? `-- ${loadState.message}\n`
      : PLSQL_SOURCE_LOADING);

  const banner =
    readOnly
      ? "Read-only — PL/SQL source (editing disabled)"
      : loadState.status === "loading"
        ? "Loading PL/SQL source…"
        : "PL/SQL source";

  const saveBlockedReason = getPlsqlSaveBlockedReason(activeTab?.id);
  const canSave = !readOnly && saveBlockedReason === null;

  return (
    <div className="plsql-editor-view">
      <div className="plsql-editor-view__banner" role="status">
        <span className="plsql-editor-view__banner-text">
          {banner}
          {ref ? ` · ${ref.schemaName}.${ref.objectName}` : ""}
        </span>
        <button
          type="button"
          className="plsql-editor-view__save"
          disabled={!canSave}
          title={
            readOnly
              ? "Read-only mode is enabled"
              : saveBlockedReason ?? "Save to database (Ctrl+S)"
          }
          onClick={() => {
            void CommandService.executeCommand("silk.file.save");
          }}
        >
          Save
        </button>
      </div>
      <div className="plsql-editor-view__body">
        <Editor
          key={activeTab?.id}
          height="100%"
          language="plsql"
          value={content}
          theme={monacoThemeForColorTheme(configuration["workbench.colorTheme"])}
          beforeMount={handleBeforeMount}
          onMount={handleMount}
          onChange={handleChange}
          options={{
            readOnly: readOnly || loadState.status === "loading",
            fontFamily: getEditorFontFamily(),
            fontSize: configuration["editor.fontSize"],
            tabSize: configuration["editor.tabSize"],
            insertSpaces: configuration["editor.insertSpaces"],
            lineNumbers: configuration["editor.lineNumbers"],
            renderLineHighlight: "line",
            minimap: { enabled: configuration["editor.minimap.enabled"] },
            wordWrap: configuration["editor.wordWrap"],
            scrollBeyondLastLine: false,
            automaticLayout: true,
          }}
        />
      </div>
    </div>
  );
}

export default PlsqlEditorView;
