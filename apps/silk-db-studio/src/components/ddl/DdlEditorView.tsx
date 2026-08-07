import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Editor } from "@monaco-editor/react";
import type { Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { getEditorFontFamily } from "@silk-studio/ui/platform/fontDefaults.ts";
import { useConfiguration } from "@silk-studio/workbench/platform/configuration/useConfiguration.ts";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import { EditorService } from "@silk-studio/editor/services/editor/editorServiceFacade.ts";
import {
  monacoModelPathForTab,
  scheduleRestoreViewState,
} from "@silk-studio/editor/services/editor/monacoModelPath.ts";
import { useActiveEditor } from "@silk-studio/editor/services/editor/useActiveEditor.ts";
import {
  defineWorkbenchMonacoThemes,
  monacoThemeForColorTheme,
} from "@silk-studio/editor/themes/dark2026-monaco.ts";
import { parseDdlEditorUri } from "../../services/connection/ddlEditorConstants";
import { bridgeFetchObjectDdl } from "../../services/connection/connectionDdlBridge";
import { formatErrorMessage } from "../../services/formatErrorMessage";
import { monacoLanguageIdForDriver } from "../../services/sql/sqlDialect";
import { ConnectionService } from "../../services/connection/connectionService";
import { registerSqlLanguages } from "../../services/sql/registerSqlLanguages";
import "./DdlEditorView.css";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; ddl: string };

function DdlEditorView() {
  const { t } = useI18n();
  const activeTab = useActiveEditor();
  const ref = parseDdlEditorUri(activeTab?.uri);
  const configuration = useConfiguration();
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  useEffect(() => {
    if (!ref) {
      setLoadState({ status: "error", message: t("app.ddl.invalidTab") });
      return;
    }

    const tabId = activeTab?.id;
    const buffered = activeTab?.content ?? "";
    const looksLoaded =
      buffered.trim().length > 0 &&
      !buffered.startsWith("-- Loading DDL") &&
      !buffered.startsWith(`-- ${t("app.ddl.loading")}`) &&
      !buffered.startsWith(`-- ${t("app.ddl.loadFailed")}`);

    if (looksLoaded) {
      const ddl = buffered.endsWith("\n") ? buffered : `${buffered}\n`;
      setLoadState({ status: "ready", ddl });
      return;
    }

    let cancelled = false;
    setLoadState({ status: "loading" });

    void bridgeFetchObjectDdl(ref.profileId, ref.schemaName, ref.objectName, ref.kind)
      .then((result) => {
        if (cancelled) return;
        const ddl = result.ddl.endsWith("\n") ? result.ddl : `${result.ddl}\n`;
        if (tabId) {
          EditorService.setTabContentSnapshot(tabId, ddl);
        }
        setLoadState({ status: "ready", ddl });
      })
      .catch((error) => {
        if (cancelled) return;
        const message = formatErrorMessage(error, t("app.ddl.loadFailed"));
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
    activeTab?.content,
    t,
  ]);

  useLayoutEffect(() => {
    const tabId = activeTab?.id;
    return () => {
      const instance = editorRef.current;
      if (instance && tabId) {
        EditorService.saveViewState(tabId, instance.saveViewState());
      }
    };
  }, [activeTab?.id]);

  const profile = ref ? ConnectionService.getProfile(ref.profileId) : undefined;
  const languageId = profile
    ? monacoLanguageIdForDriver(profile.driverId)
    : activeTab?.languageId ?? "sql";

  const handleBeforeMount = (monaco: Monaco) => {
    defineWorkbenchMonacoThemes(monaco);
    registerSqlLanguages(monaco);
  };

  const handleMount = useCallback((instance: editor.IStandaloneCodeEditor) => {
    editorRef.current = instance;
    const tabId = EditorService.getActiveTabId();
    if (tabId) {
      scheduleRestoreViewState(instance, () =>
        EditorService.getViewState(tabId),
      );
    }
  }, []);

  // readOnly editors always `setValue` in monaco-react, which resets scroll after load.
  useEffect(() => {
    if (loadState.status === "loading") return;
    const instance = editorRef.current;
    const tabId = activeTab?.id;
    if (!instance || !tabId) return;
    scheduleRestoreViewState(instance, () =>
      EditorService.getViewState(tabId),
    );
  }, [loadState, activeTab?.id]);

  const content =
    loadState.status === "ready"
      ? loadState.ddl
      : loadState.status === "error"
        ? `-- ${loadState.message}\n`
        : `-- ${t("app.ddl.loading")}\n`;

  return (
    <div className="ddl-editor-view">
      <div className="ddl-editor-view__banner" role="status">
        {t("app.ddl.banner")}
        {ref ? ` · ${ref.schemaName}.${ref.objectName}` : ""}
      </div>
      <div className="ddl-editor-view__body">
        <Editor
          height="100%"
          path={activeTab ? monacoModelPathForTab(activeTab) : undefined}
          language={languageId}
          value={loadState.status === "loading" ? undefined : content}
          theme={monacoThemeForColorTheme(configuration["workbench.colorTheme"])}
          keepCurrentModel
          saveViewState
          beforeMount={handleBeforeMount}
          onMount={handleMount}
          options={{
            readOnly: true,
            fontFamily: getEditorFontFamily(),
            fontSize: configuration["editor.fontSize"],
            tabSize: configuration["editor.tabSize"],
            insertSpaces: configuration["editor.insertSpaces"],
            lineNumbers: configuration["editor.lineNumbers"],
            renderLineHighlight: "line",
            minimap: { enabled: configuration["editor.minimap.enabled"] },
            stickyScroll: {
              enabled: configuration["editor.stickyScroll.enabled"],
            },
            wordWrap: configuration["editor.wordWrap"],
            scrollBeyondLastLine: false,
            automaticLayout: true,
          }}
        />
      </div>
    </div>
  );
}

export default DdlEditorView;
