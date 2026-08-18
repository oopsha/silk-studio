import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Editor } from "@monaco-editor/react";
import type { Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import type { MetadataObjectKind } from "@silk-studio/db-protocol";
import { getEditorFontFamily } from "@silk-studio/ui/platform/fontDefaults.ts";
import { useConfiguration } from "@silk-studio/workbench/platform/configuration/useConfiguration.ts";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import { EditorService } from "@silk-studio/editor/services/editor/editorServiceFacade.ts";
import {
  monacoModelPathForTab,
  scheduleRestoreViewState,
} from "@silk-studio/editor/services/editor/monacoModelPath.ts";
import {
  defineWorkbenchMonacoThemes,
  monacoThemeForColorTheme,
} from "@silk-studio/editor/themes/dark2026-monaco.ts";
import { bridgeFetchObjectDdl } from "../../services/connection/connectionDdlBridge";
import { formatErrorMessage } from "../../services/formatErrorMessage";
import { monacoLanguageIdForDriver } from "../../services/sql/sqlDialect";
import { ConnectionService } from "../../services/connection/connectionService";
import { registerSqlLanguages } from "../../services/sql/registerSqlLanguages";
import { registerMonacoInstance } from "../../services/editor/monacoInstanceRegistry";
import "./DdlPreview.css";

export type DdlPreviewRef = {
  profileId: string;
  schemaName: string;
  kind: MetadataObjectKind;
  objectName: string;
  catalogName?: string | null;
};

type DdlPreviewProps = {
  objectRef: DdlPreviewRef | null;
  tabId: string | undefined;
  tabUri: string | undefined;
  bufferedContent: string | undefined;
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; ddl: string };

/** Read-only DDL preview: fetches (and caches onto the owning tab) a table/view/etc's CREATE statement. */
function DdlPreview({ objectRef: ref, tabId, tabUri, bufferedContent }: DdlPreviewProps) {
  const { t } = useI18n();
  const configuration = useConfiguration();
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const unregisterMonacoRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!ref) {
      setLoadState({ status: "error", message: t("app.ddl.invalidTab") });
      return;
    }

    const buffered = bufferedContent ?? "";
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

    void bridgeFetchObjectDdl(
      ref.profileId,
      ref.schemaName,
      ref.objectName,
      ref.kind,
      undefined,
      ref.catalogName ?? undefined,
    )
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
    ref?.catalogName,
    tabId,
    bufferedContent,
    t,
  ]);

  useLayoutEffect(() => {
    return () => {
      const instance = editorRef.current;
      if (instance && tabId) {
        EditorService.saveViewState(tabId, instance.saveViewState());
      }
      unregisterMonacoRef.current();
    };
  }, [tabId]);

  const profile = ref ? ConnectionService.getProfile(ref.profileId) : undefined;
  const languageId = profile
    ? monacoLanguageIdForDriver(profile.driverId)
    : "sql";

  const handleBeforeMount = (monaco: Monaco) => {
    defineWorkbenchMonacoThemes(monaco);
    registerSqlLanguages(monaco);
  };

  const handleMount = useCallback(
    (instance: editor.IStandaloneCodeEditor) => {
      editorRef.current = instance;
      unregisterMonacoRef.current();
      unregisterMonacoRef.current = registerMonacoInstance(instance);
      if (tabId) {
        scheduleRestoreViewState(instance, () => EditorService.getViewState(tabId));
      }
    },
    [tabId],
  );

  // readOnly editors always `setValue` in monaco-react, which resets scroll after load.
  useEffect(() => {
    if (loadState.status === "loading") return;
    const instance = editorRef.current;
    if (!instance || !tabId) return;
    scheduleRestoreViewState(instance, () => EditorService.getViewState(tabId));
  }, [loadState, tabId]);

  const content =
    loadState.status === "ready"
      ? loadState.ddl
      : loadState.status === "error"
        ? `-- ${loadState.message}\n`
        : `-- ${t("app.ddl.loading")}\n`;

  return (
    <div className="ddl-preview">
      <Editor
        height="100%"
        path={tabId ? monacoModelPathForTab({ id: tabId, uri: tabUri }) : undefined}
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
  );
}

export default DdlPreview;
