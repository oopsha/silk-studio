import { useEffect, useState } from "react";
import { DiffEditor } from "@monaco-editor/react";
import type { Monaco } from "@monaco-editor/react";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { getEditorFontFamily } from "@silk-studio/ui/platform/fontDefaults.ts";
import { useConfiguration } from "@silk-studio/workbench/platform/configuration/useConfiguration.ts";
import {
  defineWorkbenchMonacoThemes,
  monacoThemeForColorTheme,
} from "@silk-studio/editor/themes/dark2026-monaco.ts";
import { AiSqlDiffDialogService } from "../../services/ai/aiSqlDiffDialogService";
import { registerSqlLanguages } from "../../services/sql/registerSqlLanguages";
import "../connections/ExplorerObjectMutationDialog.css";
import "../plsql/PlsqlSnapshotDialog.css";
import "./AiSqlDiffDialog.css";

type ReviewView = "diff" | "sql";

function AiSqlDiffDialog() {
  const [request, setRequest] = useState(() =>
    AiSqlDiffDialogService.getRequest(),
  );
  const [view, setView] = useState<ReviewView>("diff");
  const configuration = useConfiguration();

  useEffect(() => {
    return AiSqlDiffDialogService.onDidChange(() => {
      setRequest(AiSqlDiffDialogService.getRequest());
      setView("diff");
    });
  }, []);

  if (!request) {
    return null;
  }

  function close() {
    AiSqlDiffDialogService.close("cancel");
  }

  const handleBeforeMount = (monaco: Monaco) => {
    defineWorkbenchMonacoThemes(monaco);
    registerSqlLanguages(monaco);
  };

  const theme = monacoThemeForColorTheme(configuration["workbench.colorTheme"]);
  const language = request.languageId || "sql";

  return (
    <div
      className="explorer-mutation-dialog__backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          close();
        }
      }}
    >
      <div
        className="explorer-mutation-dialog plsql-snapshot-dialog--diff ai-sql-diff-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-sql-diff-dialog-title"
      >
        <header className="explorer-mutation-dialog__header">
          <h2 id="ai-sql-diff-dialog-title">Review proposed SQL</h2>
          <button
            type="button"
            className="explorer-mutation-dialog__close"
            aria-label="Close"
            onClick={close}
          >
            <Codicon name="close" />
          </button>
        </header>

        <div className="explorer-mutation-dialog__body plsql-snapshot-dialog__body">
          <p className="explorer-mutation-dialog__summary">
            Confirm before changing the editor. Nothing is executed against the
            database.
          </p>

          <div className="ai-sql-diff-dialog__tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={view === "diff"}
              className={`ai-sql-diff-dialog__tab${
                view === "diff" ? " ai-sql-diff-dialog__tab--active" : ""
              }`}
              onClick={() => setView("diff")}
            >
              Diff
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "sql"}
              className={`ai-sql-diff-dialog__tab${
                view === "sql" ? " ai-sql-diff-dialog__tab--active" : ""
              }`}
              onClick={() => setView("sql")}
            >
              SQL
            </button>
          </div>

          {view === "diff" ? (
            <>
              <p className="explorer-mutation-dialog__hint">
                Left: {request.originalLabel} · Right: proposed SQL
              </p>
              <div className="plsql-snapshot-dialog__diff">
                <DiffEditor
                  height="100%"
                  language={language}
                  original={request.original}
                  modified={request.sql}
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
            </>
          ) : (
            <>
              <p className="explorer-mutation-dialog__hint">
                Proposed SQL only. Editor is unchanged until you confirm.
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
        </div>

        <footer className="explorer-mutation-dialog__footer">
          <button
            type="button"
            className="explorer-mutation-dialog__button"
            onClick={close}
          >
            Cancel
          </button>
          <button
            type="button"
            className="explorer-mutation-dialog__button"
            onClick={() => AiSqlDiffDialogService.close("newTab")}
          >
            Open in New Tab
          </button>
          <button
            type="button"
            className="explorer-mutation-dialog__button explorer-mutation-dialog__button--primary"
            onClick={() => AiSqlDiffDialogService.close("insert")}
          >
            Insert into Editor
          </button>
        </footer>
      </div>
    </div>
  );
}

export default AiSqlDiffDialog;
