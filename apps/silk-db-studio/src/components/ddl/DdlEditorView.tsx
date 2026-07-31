import { useEffect, useState } from "react";
import { Editor } from "@monaco-editor/react";
import type { Monaco } from "@monaco-editor/react";
import { getEditorFontFamily } from "@silk-studio/ui/platform/fontDefaults.ts";
import { useConfiguration } from "@silk-studio/workbench/platform/configuration/useConfiguration.ts";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
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

  useEffect(() => {
    if (!ref) {
      setLoadState({ status: "error", message: t("app.ddl.invalidTab") });
      return;
    }

    let cancelled = false;
    setLoadState({ status: "loading" });

    void bridgeFetchObjectDdl(ref.schemaName, ref.objectName, ref.kind)
      .then((result) => {
        if (cancelled) return;
        const ddl = result.ddl.endsWith("\n") ? result.ddl : `${result.ddl}\n`;
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
    t,
  ]);

  const profile = ref ? ConnectionService.getProfile(ref.profileId) : undefined;
  const languageId = profile
    ? monacoLanguageIdForDriver(profile.driverId)
    : activeTab?.languageId ?? "sql";

  const handleBeforeMount = (monaco: Monaco) => {
    defineWorkbenchMonacoThemes(monaco);
    registerSqlLanguages(monaco);
  };

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
          key={activeTab?.id}
          height="100%"
          language={languageId}
          value={content}
          theme={monacoThemeForColorTheme(configuration["workbench.colorTheme"])}
          beforeMount={handleBeforeMount}
          options={{
            readOnly: true,
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

export default DdlEditorView;
