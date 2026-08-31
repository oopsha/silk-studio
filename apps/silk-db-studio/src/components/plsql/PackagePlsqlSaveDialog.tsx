import { useEffect, useRef, useState } from "react";
import { DiffEditor } from "@monaco-editor/react";
import type { Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { useBackdropDismiss } from "@silk-studio/ui/hooks/useBackdropDismiss.ts";
import { getEditorFontFamily } from "@silk-studio/ui/platform/fontDefaults.ts";
import { useConfiguration } from "@silk-studio/workbench/platform/configuration/useConfiguration.ts";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import {
  defineWorkbenchMonacoThemes,
  monacoThemeForColorTheme,
} from "@silk-studio/editor/themes/dark-monaco.ts";
import { PackagePlsqlSaveDialogService } from "../../services/connection/packagePlsqlSaveDialogService";
import { formatErrorMessage } from "../../services/formatErrorMessage";
import { registerSqlLanguages } from "../../services/sql/registerSqlLanguages";
import { useResizableDialogSize } from "../../services/ui/useResizableDialogSize";
import "../connections/ExplorerObjectMutationDialog.css";
import "./PlsqlSnapshotDialog.css";
import "./PlsqlSaveDialog.css";

function PackagePlsqlSaveDialog() {
  const { t } = useI18n();
  const [request, setRequest] = useState(() =>
    PackagePlsqlSaveDialogService.getRequest(),
  );
  const [activeSectionId, setActiveSectionId] = useState<"spec" | "body" | null>(
    null,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);
  const configuration = useConfiguration();
  const resizableRef = useResizableDialogSize("silk-db-studio.packagePlsqlSaveDialog.size");
  const diffEditorRef = useRef<editor.IStandaloneDiffEditor | null>(null);

  function close() {
    if (executing) return;
    PackagePlsqlSaveDialogService.close();
  }

  const backdropDismiss = useBackdropDismiss(close, !executing);

  useEffect(() => {
    return PackagePlsqlSaveDialogService.onDidChange(() => {
      const next = PackagePlsqlSaveDialogService.getRequest();
      setRequest(next);
      setActiveSectionId(next?.sections[0]?.id ?? null);
      setErrorMessage(null);
      setExecuting(false);
    });
  }, []);

  if (!request) {
    return null;
  }

  const activeSection =
    request.sections.find((section) => section.id === activeSectionId) ??
    request.sections[0];

  async function handleConfirm() {
    if (!request || executing) return;
    setExecuting(true);
    setErrorMessage(null);
    try {
      await request.onConfirm();
      PackagePlsqlSaveDialogService.close();
    } catch (error) {
      setErrorMessage(formatErrorMessage(error, t("app.plsql.saveFailed")));
      setExecuting(false);
    }
  }

  const handleBeforeMount = (monaco: Monaco) => {
    defineWorkbenchMonacoThemes(monaco);
    registerSqlLanguages(monaco);
  };

  const handleDiffMount = (instance: editor.IStandaloneDiffEditor) => {
    diffEditorRef.current = instance;
  };

  const theme = monacoThemeForColorTheme(configuration["workbench.colorTheme"]);

  return (
    <div
      className="explorer-mutation-dialog__backdrop"
      role="presentation"
      {...backdropDismiss}
    >
      <div
        ref={resizableRef}
        className="explorer-mutation-dialog plsql-snapshot-dialog--diff plsql-save-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="package-plsql-save-dialog-title"
      >
        <header className="explorer-mutation-dialog__header">
          <h2 id="package-plsql-save-dialog-title">
            {t("app.plsql.saveDialogTitle")}
          </h2>
          <button
            type="button"
            className="explorer-mutation-dialog__close"
            aria-label={t("common.close")}
            disabled={executing}
            onClick={close}
          >
            <Codicon name="close" />
          </button>
        </header>

        <div className="explorer-mutation-dialog__body plsql-snapshot-dialog__body">
          <p className="explorer-mutation-dialog__summary">
            {t("app.plsql.saveDialogSummary").replace(
              "{label}",
              request.objectLabel,
            )}
          </p>

          {request.sections.length > 1 ? (
            <div className="plsql-save-dialog__tabs" role="tablist">
              {request.sections.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  role="tab"
                  aria-selected={section.id === activeSection?.id}
                  className={`plsql-save-dialog__tab${
                    section.id === activeSection?.id
                      ? " plsql-save-dialog__tab--active"
                      : ""
                  }`}
                  disabled={executing}
                  onClick={() => setActiveSectionId(section.id)}
                >
                  {section.label}
                </button>
              ))}
            </div>
          ) : null}

          {activeSection ? (
            <>
              <div className="plsql-save-dialog__diff-toolbar">
                <p className="explorer-mutation-dialog__hint">
                  {t("app.plsql.diffVsDatabase")}
                </p>
                {!activeSection.beforeLoading && activeSection.before !== null ? (
                  <div className="plsql-save-dialog__diff-nav">
                    <button
                      type="button"
                      className="explorer-mutation-dialog__button"
                      title={t("app.plsql.previousDiff")}
                      onClick={() => diffEditorRef.current?.goToDiff("previous")}
                    >
                      <Codicon name="arrow-up" />
                    </button>
                    <button
                      type="button"
                      className="explorer-mutation-dialog__button"
                      title={t("app.plsql.nextDiff")}
                      onClick={() => diffEditorRef.current?.goToDiff("next")}
                    >
                      <Codicon name="arrow-down" />
                    </button>
                  </div>
                ) : null}
              </div>
              {activeSection.beforeLoading ? (
                <p className="explorer-mutation-dialog__hint">
                  {t("app.plsql.sourceLoading")}
                </p>
              ) : null}
              {activeSection.beforeError ? (
                <p className="explorer-mutation-dialog__error" role="alert">
                  {activeSection.beforeError}
                </p>
              ) : null}
              {!activeSection.beforeLoading && activeSection.before !== null ? (
                <div className="plsql-snapshot-dialog__diff">
                  <DiffEditor
                    height="100%"
                    language="plsql"
                    original={activeSection.before}
                    modified={activeSection.after}
                    theme={theme}
                    beforeMount={handleBeforeMount}
                    onMount={handleDiffMount}
                    options={{
                      readOnly: true,
                      renderSideBySide: true,
                      fontFamily: getEditorFontFamily(),
                      fontSize: configuration["editor.fontSize"],
                      minimap: { enabled: false },
                      scrollBeyondLastLine: false,
                      automaticLayout: true,
                    }}
                  />
                </div>
              ) : null}
            </>
          ) : null}

          {request.warnings.length > 0 ? (
            <ul className="explorer-mutation-dialog__hint" role="status">
              {request.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}
          {errorMessage ? (
            <p className="explorer-mutation-dialog__error" role="alert">
              {errorMessage}
            </p>
          ) : null}
        </div>

        <footer className="explorer-mutation-dialog__footer">
          <button
            type="button"
            className="explorer-mutation-dialog__button"
            disabled={executing}
            onClick={close}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="explorer-mutation-dialog__button explorer-mutation-dialog__button--primary"
            disabled={executing}
            onClick={() => void handleConfirm()}
          >
            {executing
              ? t("app.plsql.saving")
              : t("app.plsql.executeCreateOrReplace")}
          </button>
        </footer>
      </div>
    </div>
  );
}

export default PackagePlsqlSaveDialog;
