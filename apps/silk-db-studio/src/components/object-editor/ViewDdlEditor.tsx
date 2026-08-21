import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Editor } from "@monaco-editor/react";
import type { Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
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
import type { ObjectEditorRef } from "../../services/connection/objectEditorConstants";
import { bridgeFetchObjectDdl } from "../../services/connection/connectionDdlBridge";
import { formatErrorMessage } from "../../services/formatErrorMessage";
import { ConnectionService } from "../../services/connection/connectionService";
import type { PlsqlEditorRef } from "../../services/connection/plsqlEditorConstants";
import { revealPlsqlCompileError } from "../../services/connection/plsqlCompileMarkers";
import {
  compileActivePlsqlObject,
  getPlsqlCompileBlockedReason,
} from "../../services/connection/plsqlCompileService";
import {
  PlsqlCompileStateService,
  type PlsqlCompileState,
} from "../../services/connection/plsqlCompileStateService";
import {
  getPlsqlSaveBlockedReason,
  openPlsqlSaveDialog,
} from "../../services/connection/plsqlSaveService";
import {
  getPlsqlSnapshotBlockedReason,
  openPlsqlReloadConfirm,
  openPlsqlSnapshotHistory,
  takeManualPlsqlSnapshot,
} from "../../services/connection/plsqlSnapshotService";
import { registerMonacoInstance } from "../../services/editor/monacoInstanceRegistry";
import { registerSqlLanguages } from "../../services/sql/registerSqlLanguages";
import { supportsCompileDiagnostics } from "../../services/sql/sqlDialect";
import "./ViewDdlEditor.css";

type ViewDdlEditorProps = {
  objectRef: ObjectEditorRef;
  tabId: string;
  tabUri: string | undefined;
  bufferedContent: string | undefined;
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready" };

/**
 * Editable DDL view for a VIEW, embedded in the Object Editor's Properties → DDL section (see
 * `PropertiesView.tsx`). Reuses the same history/snapshot/reload/save/compile machinery
 * `PlsqlEditorView.tsx` uses for procedure/function/package source tabs — the only structural
 * difference is that this lives inside a shared `silk://object/...` tab instead of its own
 * dedicated `silk://plsql/...` tab, so every action below is addressed by `tabId` (resolved via
 * `resolvePlsqlSourceRef` inside the service layer) rather than a command that assumes the
 * active tab *is* the PL/SQL tab.
 *
 * Supported drivers: Oracle, PostgreSQL, MySQL, MariaDB (see `supportsPlsqlSourceEdit` in
 * `plsqlEditorService.ts`). Only Oracle runs a post-save compile-diagnostics step
 * (`ALTER ... COMPILE` + `ALL_ERRORS`); the others have no equivalent — any syntax/reference
 * error there already surfaces as a failed `CREATE OR REPLACE` statement.
 */
function ViewDdlEditor({ objectRef, tabId, tabUri, bufferedContent }: ViewDdlEditorProps) {
  const { t } = useI18n();
  const activeTab = useActiveEditor();
  const configuration = useConfiguration();
  const readOnly = configuration["database.readOnly"];
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [compileState, setCompileState] = useState<PlsqlCompileState>(() =>
    PlsqlCompileStateService.getState(),
  );
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const unregisterMonacoRef = useRef<() => void>(() => {});

  const ref: PlsqlEditorRef = {
    profileId: objectRef.profileId,
    schemaName: objectRef.schemaName,
    kind: objectRef.kind,
    objectName: objectRef.objectName,
  };

  const hasCompileDiagnostics = useMemo(() => {
    const driverId = ConnectionService.getProfile(objectRef.profileId)?.driverId;
    return driverId !== undefined && supportsCompileDiagnostics(driverId);
  }, [objectRef.profileId]);

  // This component only ever mounts for the active tab (see PropertiesView's own per-tab
  // remount note), but fall back to the props snapshot for the brief window before the
  // active-editor hook resync catches up on a tab switch.
  const liveTab = activeTab?.id === tabId ? activeTab : undefined;
  const content =
    loadState.status === "loading"
      ? `-- ${t("app.ddl.loading")}\n`
      : (liveTab?.content ?? bufferedContent ?? "");

  useEffect(() => {
    return PlsqlCompileStateService.onDidChange(() => {
      setCompileState(PlsqlCompileStateService.getState());
    });
  }, []);

  useEffect(() => {
    const buffered = bufferedContent ?? "";
    const looksLoaded =
      buffered.trim().length > 0 &&
      !buffered.startsWith(`-- ${t("app.ddl.loading")}`) &&
      !buffered.startsWith(`-- ${t("app.ddl.loadFailed")}`);

    if (looksLoaded) {
      setLoadState({ status: "ready" });
      return;
    }

    let cancelled = false;
    setLoadState({ status: "loading" });

    void bridgeFetchObjectDdl(ref.profileId, ref.schemaName, ref.objectName, ref.kind)
      .then((result) => {
        if (cancelled) return;
        const source = result.ddl.endsWith("\n") ? result.ddl : `${result.ddl}\n`;
        EditorService.setTabContentBaseline(tabId, source);
        setLoadState({ status: "ready" });
      })
      .catch((error) => {
        if (cancelled) return;
        const message = formatErrorMessage(error, t("app.ddl.loadFailed"));
        const fallback = `-- ${t("app.ddl.loadFailed")}\n-- ${message}\n`;
        EditorService.setTabContentBaseline(tabId, fallback);
        setLoadState({ status: "error", message });
      });

    return () => {
      cancelled = true;
    };
  }, [
    ref.profileId,
    ref.schemaName,
    ref.objectName,
    ref.kind,
    tabId,
    bufferedContent,
    t,
  ]);

  useLayoutEffect(() => {
    return () => {
      const instance = editorRef.current;
      if (instance) {
        EditorService.saveViewState(tabId, instance.saveViewState());
      }
      unregisterMonacoRef.current();
    };
  }, [tabId]);

  useEffect(() => {
    const instance = editorRef.current;
    if (!instance) return;
    scheduleRestoreViewState(instance, () => EditorService.getViewState(tabId));
  }, [tabId]);

  useEffect(() => {
    return () => {
      EditorService.setActiveTextEditor(null);
      editorRef.current = null;
    };
  }, [tabId]);

  const handleBeforeMount = (monaco: Monaco) => {
    defineWorkbenchMonacoThemes(monaco);
    registerSqlLanguages(monaco);
  };

  const handleMount = useCallback(
    (instance: editor.IStandaloneCodeEditor) => {
      editorRef.current = instance;
      EditorService.setActiveTextEditor(instance);
      unregisterMonacoRef.current();
      unregisterMonacoRef.current = registerMonacoInstance(instance);
      scheduleRestoreViewState(instance, () => EditorService.getViewState(tabId));
    },
    [tabId],
  );

  const handleChange = useCallback(
    (value: string | undefined) => {
      if (value === undefined || readOnly) return;
      EditorService.updateTabContent(tabId, value);
    },
    [tabId, readOnly],
  );

  const banner =
    readOnly
      ? t("app.plsql.sourceReadOnly")
      : loadState.status === "loading"
        ? t("app.plsql.sourceLoading")
        : t("app.plsql.sourceLabel");

  const saveBlockedReason = getPlsqlSaveBlockedReason(tabId);
  const canSave = !readOnly && saveBlockedReason === null;
  const compileBlockedReason = getPlsqlCompileBlockedReason(tabId);
  const canCompile =
    !readOnly && compileBlockedReason === null && compileState.status !== "compiling";
  const snapshotBlockedReason = getPlsqlSnapshotBlockedReason(tabId);
  const canSnapshot = snapshotBlockedReason === null;

  const showCompilePanel =
    compileState.tabId === tabId &&
    (compileState.status === "success" ||
      compileState.status === "error" ||
      compileState.status === "failed" ||
      compileState.status === "compiling");

  const handleHistory = () => {
    try {
      openPlsqlSnapshotHistory(tabId);
    } catch (error) {
      window.alert(formatErrorMessage(error, "Failed to open snapshot history."));
    }
  };

  const handleSnapshot = () => {
    try {
      takeManualPlsqlSnapshot(tabId);
      window.alert("Snapshot saved locally.");
    } catch (error) {
      window.alert(formatErrorMessage(error, "Failed to take snapshot."));
    }
  };

  const handleReload = () => {
    try {
      openPlsqlReloadConfirm(tabId);
    } catch (error) {
      window.alert(formatErrorMessage(error, "Failed to prepare reload."));
    }
  };

  const handleCompile = () => {
    void compileActivePlsqlObject(tabId).catch((error) => {
      window.alert(formatErrorMessage(error, "Failed to compile view."));
    });
  };

  const handleSave = () => {
    void openPlsqlSaveDialog(tabId).catch((error) => {
      window.alert(formatErrorMessage(error, "Failed to prepare view save."));
    });
  };

  return (
    <div className="view-ddl-editor">
      <div className="view-ddl-editor__banner" role="status">
        <span className="view-ddl-editor__banner-text">
          {banner}
          {showCompilePanel && compileState.message ? ` · ${compileState.message}` : ""}
        </span>
        <div className="view-ddl-editor__actions">
          <button
            type="button"
            className="view-ddl-editor__action"
            disabled={!canSnapshot}
            title={snapshotBlockedReason ?? t("app.plsql.snapshotHistory")}
            onClick={handleHistory}
          >
            <Codicon name="history" />
            {t("app.plsql.actionHistory")}
          </button>
          <button
            type="button"
            className="view-ddl-editor__action"
            disabled={!canSnapshot}
            title={snapshotBlockedReason ?? t("app.plsql.takeSnapshot")}
            onClick={handleSnapshot}
          >
            <Codicon name="save-all" />
            {t("app.plsql.actionSnapshot")}
          </button>
          <button
            type="button"
            className="view-ddl-editor__action"
            disabled={!canSnapshot}
            title={snapshotBlockedReason ?? t("app.plsql.reloadFromDb")}
            onClick={handleReload}
          >
            <Codicon name="refresh" />
            {t("app.plsql.actionReload")}
          </button>
          <button
            type="button"
            className="view-ddl-editor__action"
            disabled={!canCompile}
            title={
              readOnly
                ? t("app.plsql.readOnlyEnabled")
                : (compileBlockedReason ??
                  t(hasCompileDiagnostics ? "app.plsql.compileTitle" : "app.plsql.compileTitleNoDiagnostics"))
            }
            onClick={handleCompile}
          >
            <Codicon name="save" />
            {t("app.plsql.actionCompile")}
          </button>
          <button
            type="button"
            className="view-ddl-editor__action"
            disabled={!canSave}
            title={
              readOnly
                ? t("app.plsql.readOnlyEnabled")
                : (saveBlockedReason ??
                  t(hasCompileDiagnostics ? "app.plsql.saveTitle" : "app.plsql.saveTitleNoDiagnostics"))
            }
            onClick={handleSave}
          >
            <Codicon name="diff" />
            {t("app.plsql.actionSave")}
          </button>
        </div>
      </div>
      {showCompilePanel && compileState.errors.length > 0 ? (
        <div className="view-ddl-editor__errors" role="list">
          {compileState.errors.map((item, index) => (
            <button
              key={`${item.sequence ?? index}-${item.line}-${item.column}-${item.message}`}
              type="button"
              className="view-ddl-editor__error"
              role="listitem"
              onClick={() => revealPlsqlCompileError(item.line, item.column)}
            >
              <span className="view-ddl-editor__error-loc">
                {item.line}:{item.column}
              </span>
              <span className="view-ddl-editor__error-msg">{item.message}</span>
            </button>
          ))}
        </div>
      ) : null}
      {showCompilePanel && compileState.status === "failed" && compileState.message ? (
        <div className="view-ddl-editor__errors" role="alert">
          <div className="view-ddl-editor__error view-ddl-editor__error--static">
            {compileState.message}
          </div>
        </div>
      ) : null}
      <div className="view-ddl-editor__body">
        <Editor
          height="100%"
          path={monacoModelPathForTab({ id: tabId, uri: tabUri })}
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

export default ViewDdlEditor;
