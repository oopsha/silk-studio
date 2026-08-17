import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Editor } from "@monaco-editor/react";
import type { Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { getEditorFontFamily } from "@silk-studio/ui/platform/fontDefaults.ts";
import { CommandService } from "@silk-studio/workbench/platform/commands/commandService.ts";
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
import { bridgeFetchObjectDdl } from "../../services/connection/connectionDdlBridge";
import { formatErrorMessage } from "../../services/formatErrorMessage";
import {
  isPlsqlSourceLoaded,
  parsePlsqlEditorUri,
  PLSQL_SOURCE_LOADING,
} from "../../services/connection/plsqlEditorConstants";
import { revealPlsqlCompileError } from "../../services/connection/plsqlCompileMarkers";
import {
  getPlsqlCompileBlockedReason,
} from "../../services/connection/plsqlCompileService";
import {
  PlsqlCompileStateService,
  type PlsqlCompileState,
} from "../../services/connection/plsqlCompileStateService";
import { getPlsqlSaveBlockedReason } from "../../services/connection/plsqlSaveService";
import { getPlsqlSnapshotBlockedReason } from "../../services/connection/plsqlSnapshotService";
import { registerSqlLanguages } from "../../services/sql/registerSqlLanguages";
import "./PlsqlEditorView.css";

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string };

function PlsqlEditorView() {
  const { t } = useI18n();
  const activeTab = useActiveEditor();
  const ref = parsePlsqlEditorUri(activeTab?.uri);
  const configuration = useConfiguration();
  const readOnly = configuration["database.readOnly"];
  const [loadState, setLoadState] = useState<LoadState>({ status: "idle" });
  const [compileState, setCompileState] = useState<PlsqlCompileState>(() =>
    PlsqlCompileStateService.getState(),
  );
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  useEffect(() => {
    return PlsqlCompileStateService.onDidChange(() => {
      setCompileState(PlsqlCompileStateService.getState());
    });
  }, []);

  useEffect(() => {
    if (!ref || !activeTab) {
      setLoadState({ status: "error", message: t("app.plsql.invalidTab") });
      return;
    }

    if (isPlsqlSourceLoaded(activeTab.content)) {
      setLoadState({ status: "idle" });
      return;
    }

    let cancelled = false;
    setLoadState({ status: "loading" });

    void bridgeFetchObjectDdl(
      ref.profileId,
      ref.schemaName,
      ref.objectName,
      ref.kind,
      ref.packageBody,
    )
      .then((result) => {
        if (cancelled || !activeTab) return;
        const source = result.ddl.endsWith("\n") ? result.ddl : `${result.ddl}\n`;
        EditorService.setTabContentBaseline(activeTab.id, source);
        setLoadState({ status: "idle" });
      })
      .catch((error) => {
        if (cancelled) return;
        const message = formatErrorMessage(error, t("app.plsql.loadFailed"));
        const fallback = `-- ${t("app.plsql.loadFailed")}\n-- ${message}\n`;
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
    ref?.packageBody,
    activeTab?.id,
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

  // After tab switch, controlled `value` sync can reset scroll — restore after that.
  useEffect(() => {
    const instance = editorRef.current;
    const tabId = activeTab?.id;
    if (!instance || !tabId) return;
    scheduleRestoreViewState(instance, () =>
      EditorService.getViewState(tabId),
    );
  }, [activeTab?.id]);

  useEffect(() => {
    return () => {
      EditorService.setActiveTextEditor(null);
      editorRef.current = null;
    };
  }, [activeTab?.id]);

  const handleBeforeMount = (monaco: Monaco) => {
    defineWorkbenchMonacoThemes(monaco);
    registerSqlLanguages(monaco);
  };

  const handleMount = useCallback((instance: editor.IStandaloneCodeEditor) => {
    editorRef.current = instance;
    EditorService.setActiveTextEditor(instance);
    const tabId = EditorService.getActiveTabId();
    if (tabId) {
      scheduleRestoreViewState(instance, () =>
        EditorService.getViewState(tabId),
      );
    }
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
      ? t("app.plsql.sourceReadOnly")
      : loadState.status === "loading"
        ? t("app.plsql.sourceLoading")
        : t("app.plsql.sourceLabel");

  const saveBlockedReason = getPlsqlSaveBlockedReason(activeTab?.id);
  const canSave = !readOnly && saveBlockedReason === null;
  const compileBlockedReason = getPlsqlCompileBlockedReason(activeTab?.id);
  const canCompile =
    !readOnly &&
    compileBlockedReason === null &&
    compileState.status !== "compiling";
  const snapshotBlockedReason = getPlsqlSnapshotBlockedReason(activeTab?.id);
  const canSnapshot = snapshotBlockedReason === null;

  const showCompilePanel =
    !!activeTab &&
    compileState.tabId === activeTab.id &&
    (compileState.status === "success" ||
      compileState.status === "error" ||
      compileState.status === "failed" ||
      compileState.status === "compiling");

  return (
    <div className="plsql-editor-view">
      <div className="plsql-editor-view__banner" role="status">
        <span className="plsql-editor-view__banner-text">
          {banner}
          {ref
            ? ` · ${ref.schemaName}.${ref.objectName}${
                ref.kind === "package"
                  ? ref.packageBody
                    ? " (body)"
                    : " (spec)"
                  : ""
              }`
            : ""}
          {showCompilePanel && compileState.message
            ? ` · ${compileState.message}`
            : ""}
        </span>
        <div className="plsql-editor-view__actions">
          <button
            type="button"
            className="plsql-editor-view__action"
            disabled={!canSnapshot}
            title={snapshotBlockedReason ?? t("app.plsql.snapshotHistory")}
            onClick={() => {
              void CommandService.executeCommand("silk.plsql.snapshot.history");
            }}
          >
            <Codicon name="history" />
            {t("app.plsql.actionHistory")}
          </button>
          <button
            type="button"
            className="plsql-editor-view__action"
            disabled={!canSnapshot}
            title={snapshotBlockedReason ?? t("app.plsql.takeSnapshot")}
            onClick={() => {
              void CommandService.executeCommand("silk.plsql.snapshot.take");
            }}
          >
            <Codicon name="save-all" />
            {t("app.plsql.actionSnapshot")}
          </button>
          <button
            type="button"
            className="plsql-editor-view__action"
            disabled={!canSnapshot}
            title={snapshotBlockedReason ?? t("app.plsql.reloadFromDb")}
            onClick={() => {
              void CommandService.executeCommand("silk.plsql.reloadFromDb");
            }}
          >
            <Codicon name="refresh" />
            {t("app.plsql.actionReload")}
          </button>
          <button
            type="button"
            className="plsql-editor-view__action"
            disabled={!canCompile}
            title={
              readOnly
                ? t("app.plsql.readOnlyEnabled")
                : compileBlockedReason ?? t("app.plsql.compileTitle")
            }
            onClick={() => {
              void CommandService.executeCommand("silk.plsql.compile");
            }}
          >
            <Codicon name="server-process" />
            {t("app.plsql.actionCompile")}
          </button>
          <button
            type="button"
            className="plsql-editor-view__action"
            disabled={!canSave}
            title={
              readOnly
                ? t("app.plsql.readOnlyEnabled")
                : saveBlockedReason ?? t("app.plsql.saveTitle")
            }
            onClick={() => {
              void CommandService.executeCommand("silk.file.save");
            }}
          >
            <Codicon name="save" />
            {t("app.plsql.actionSave")}
          </button>
        </div>
      </div>
      {showCompilePanel && compileState.errors.length > 0 ? (
        <div className="plsql-editor-view__errors" role="list">
          {compileState.errors.map((item, index) => (
            <button
              key={`${item.sequence ?? index}-${item.line}-${item.column}-${item.message}`}
              type="button"
              className="plsql-editor-view__error"
              role="listitem"
              onClick={() => revealPlsqlCompileError(item.line, item.column)}
            >
              <span className="plsql-editor-view__error-loc">
                {item.line}:{item.column}
              </span>
              <span className="plsql-editor-view__error-msg">{item.message}</span>
            </button>
          ))}
        </div>
      ) : null}
      {showCompilePanel &&
      compileState.status === "failed" &&
      compileState.message ? (
        <div className="plsql-editor-view__errors" role="alert">
          <div className="plsql-editor-view__error plsql-editor-view__error--static">
            {compileState.message}
          </div>
        </div>
      ) : null}
      <div className="plsql-editor-view__body">
        <Editor
          height="100%"
          path={activeTab ? monacoModelPathForTab(activeTab) : undefined}
          language="plsql"
          value={content}
          theme={monacoThemeForColorTheme(configuration["workbench.colorTheme"])}
          keepCurrentModel
          saveViewState
          beforeMount={handleBeforeMount}
          onMount={handleMount}
          onChange={handleChange}
          options={{
            readOnly: readOnly || loadState.status === "loading",
            fontFamily: getEditorFontFamily(),
            fontSize: configuration["editor.fontSize"],
            tabSize: configuration["editor.tabSize"],
            insertSpaces: configuration["editor.insertSpaces"],
            // See EditorArea.tsx's identical option for why this must be off.
            detectIndentation: false,
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

export default PlsqlEditorView;
