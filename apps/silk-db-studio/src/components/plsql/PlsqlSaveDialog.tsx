import { useEffect, useState } from "react";
import { DiffEditor } from "@monaco-editor/react";
import type { Monaco } from "@monaco-editor/react";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { getEditorFontFamily } from "@silk-studio/ui/platform/fontDefaults.ts";
import { useConfiguration } from "@silk-studio/workbench/platform/configuration/useConfiguration.ts";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import {
  defineWorkbenchMonacoThemes,
  monacoThemeForColorTheme,
} from "@silk-studio/editor/themes/dark2026-monaco.ts";
import { PlsqlSaveDialogService } from "../../services/connection/plsqlSaveDialogService";
import {
  executePlsqlSave,
  formatPlsqlSaveError,
} from "../../services/connection/plsqlSaveService";
import { registerSqlLanguages } from "../../services/sql/registerSqlLanguages";
import "../connections/ExplorerObjectMutationDialog.css";
import "./PlsqlSnapshotDialog.css";
import "./PlsqlSaveDialog.css";

type SaveView = "diff" | "sql";

function PlsqlSaveDialog() {
  const { t } = useI18n();
  const [request, setRequest] = useState(() =>
    PlsqlSaveDialogService.getRequest(),
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);
  const [view, setView] = useState<SaveView>("diff");
  const configuration = useConfiguration();

  useEffect(() => {
    return PlsqlSaveDialogService.onDidChange(() => {
      setRequest(PlsqlSaveDialogService.getRequest());
      setErrorMessage(null);
      setExecuting(false);
      setView("diff");
    });
  }, []);

  if (!request) {
    return null;
  }

  function close() {
    if (executing) return;
    PlsqlSaveDialogService.close(false);
  }

  async function handleConfirm() {
    if (!request || executing) return;
    const current = request;
    setExecuting(true);
    setErrorMessage(null);
    try {
      await executePlsqlSave(current.tabId, current.ref, current.sql);
      PlsqlSaveDialogService.close(true);
    } catch (error) {
      setErrorMessage(
        formatPlsqlSaveError(error, t("app.plsql.saveFailed")),
      );
      setExecuting(false);
    }
  }

  const handleBeforeMount = (monaco: Monaco) => {
    defineWorkbenchMonacoThemes(monaco);
    registerSqlLanguages(monaco);
  };

  const theme = monacoThemeForColorTheme(configuration["workbench.colorTheme"]);

  return (
    <div
      className="explorer-mutation-dialog__backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget && !executing) {
          close();
        }
      }}
    >
      <div
        className="explorer-mutation-dialog plsql-snapshot-dialog--diff plsql-save-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="plsql-save-dialog-title"
      >
        <header className="explorer-mutation-dialog__header">
          <h2 id="plsql-save-dialog-title">{t("app.plsql.saveDialogTitle")}</h2>
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

          <div className="plsql-save-dialog__tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={view === "diff"}
              className={`plsql-save-dialog__tab${
                view === "diff" ? " plsql-save-dialog__tab--active" : ""
              }`}
              disabled={executing}
              onClick={() => setView("diff")}
            >
              {t("app.plsql.diffVsDatabase")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "sql"}
              className={`plsql-save-dialog__tab${
                view === "sql" ? " plsql-save-dialog__tab--active" : ""
              }`}
              disabled={executing}
              onClick={() => setView("sql")}
            >
              {t("app.plsql.sqlTab")}
            </button>
          </div>

          {view === "diff" ? (
            <>
              <p className="explorer-mutation-dialog__hint">
                Left: current database source · Right: editor buffer
              </p>
              {request.dbSourceLoading ? (
                <p className="explorer-mutation-dialog__hint">
                  Loading database source…
                </p>
              ) : null}
              {request.dbSourceError ? (
                <p className="explorer-mutation-dialog__error" role="alert">
                  {request.dbSourceError}
                </p>
              ) : null}
              {!request.dbSourceLoading && request.dbSource ? (
                <div className="plsql-snapshot-dialog__diff">
                  <DiffEditor
                    height="100%"
                    language="plsql"
                    original={request.dbSource}
                    modified={request.bufferContent}
                    theme={theme}
                    beforeMount={handleBeforeMount}
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
              {!request.dbSourceLoading &&
              !request.dbSource &&
              !request.dbSourceError ? (
                <p className="explorer-mutation-dialog__hint">
                  No database source available for diff. Review the SQL tab
                  before confirming.
                </p>
              ) : null}
            </>
          ) : (
            <>
              <p className="explorer-mutation-dialog__hint">
                Review the SQL below. Nothing is written until you confirm.
              </p>
              <pre className="explorer-mutation-dialog__sql">{request.sql}</pre>
            </>
          )}

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

export default PlsqlSaveDialog;
