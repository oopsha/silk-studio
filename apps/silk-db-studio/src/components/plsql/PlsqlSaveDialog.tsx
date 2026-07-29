import { useEffect, useState } from "react";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { PlsqlSaveDialogService } from "../../services/connection/plsqlSaveDialogService";
import {
  executePlsqlSave,
  formatPlsqlSaveError,
} from "../../services/connection/plsqlSaveService";
import "../connections/ExplorerObjectMutationDialog.css";

function PlsqlSaveDialog() {
  const [request, setRequest] = useState(() =>
    PlsqlSaveDialogService.getRequest(),
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);

  useEffect(() => {
    return PlsqlSaveDialogService.onDidChange(() => {
      setRequest(PlsqlSaveDialogService.getRequest());
      setErrorMessage(null);
      setExecuting(false);
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
        formatPlsqlSaveError(error, "Failed to save PL/SQL object."),
      );
      setExecuting(false);
    }
  }

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
        className="explorer-mutation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="plsql-save-dialog-title"
      >
        <header className="explorer-mutation-dialog__header">
          <h2 id="plsql-save-dialog-title">Save PL/SQL to Database</h2>
          <button
            type="button"
            className="explorer-mutation-dialog__close"
            aria-label="Close"
            disabled={executing}
            onClick={close}
          >
            <Codicon name="close" />
          </button>
        </header>

        <div className="explorer-mutation-dialog__body">
          <p className="explorer-mutation-dialog__summary">
            Apply <strong>{request.objectLabel}</strong> with{" "}
            <strong>CREATE OR REPLACE</strong>?
          </p>
          <p className="explorer-mutation-dialog__hint">
            Review the SQL below. Nothing is written until you confirm.
          </p>
          {request.warnings.length > 0 ? (
            <ul className="explorer-mutation-dialog__hint" role="status">
              {request.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}
          <pre className="explorer-mutation-dialog__sql">{request.sql}</pre>
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
            Cancel
          </button>
          <button
            type="button"
            className="explorer-mutation-dialog__button explorer-mutation-dialog__button--primary"
            disabled={executing}
            onClick={() => void handleConfirm()}
          >
            {executing ? "Saving…" : "Execute CREATE OR REPLACE"}
          </button>
        </footer>
      </div>
    </div>
  );
}

export default PlsqlSaveDialog;
