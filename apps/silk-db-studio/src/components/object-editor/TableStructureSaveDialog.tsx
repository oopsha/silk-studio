import { useEffect, useState } from "react";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { useBackdropDismiss } from "@silk-studio/ui/hooks/useBackdropDismiss.ts";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import { TableStructureSaveDialogService } from "../../services/connection/tableStructureSaveDialogService";
import {
  executeTableStructureSave,
  formatTableStructureSaveError,
} from "../../services/connection/tableStructureSaveService";
import type { ColumnChange, FieldChange } from "../../services/connection/tableStructureDiff";
import "../connections/ExplorerObjectMutationDialog.css";
import "../plsql/PlsqlSaveDialog.css";
import "./TableStructureSaveDialog.css";

type SaveView = "changes" | "sql";

function renderFieldChange(label: string, change: FieldChange<unknown> | null) {
  if (!change) return null;
  const before = change.before === null || change.before === undefined ? "—" : String(change.before);
  const after = change.after === null || change.after === undefined ? "—" : String(change.after);
  return (
    <div className="table-structure-save-dialog__field-change">
      {label}: <strong>{before}</strong> → <strong>{after}</strong>
    </div>
  );
}

function ChangeEntry({ change }: { change: ColumnChange }) {
  if (change.op === "add") {
    return (
      <div className="table-structure-save-dialog__entry">
        <span className="table-structure-save-dialog__entry-name">{change.column.name}</span>
      </div>
    );
  }
  if (change.op === "drop") {
    return (
      <div className="table-structure-save-dialog__entry">
        <span className="table-structure-save-dialog__entry-name">{change.original.name}</span>
      </div>
    );
  }
  return (
    <div className="table-structure-save-dialog__entry">
      <span className="table-structure-save-dialog__entry-name">
        {change.renamed ? change.renamed.after : change.original.name}
      </span>
      {renderFieldChange("name", change.renamed)}
      {renderFieldChange("type", change.type)}
      {renderFieldChange("nullable", change.nullable)}
      {renderFieldChange("default", change.defaultValue)}
      {renderFieldChange("comment", change.comment)}
    </div>
  );
}

function TableStructureSaveDialog() {
  const { t } = useI18n();
  const [request, setRequest] = useState(() => TableStructureSaveDialogService.getRequest());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);
  const [view, setView] = useState<SaveView>("changes");

  function close() {
    if (executing) return;
    TableStructureSaveDialogService.close(false);
  }

  const backdropDismiss = useBackdropDismiss(close, !executing);

  useEffect(() => {
    return TableStructureSaveDialogService.onDidChange(() => {
      setRequest(TableStructureSaveDialogService.getRequest());
      setErrorMessage(null);
      setExecuting(false);
      setView("changes");
    });
  }, []);

  if (!request) {
    return null;
  }

  async function handleConfirm() {
    if (!request || executing || request.blockers.length > 0) return;
    const current = request;
    setExecuting(true);
    setErrorMessage(null);
    try {
      await executeTableStructureSave(
        current.tabId,
        current.ref,
        current.statements,
        current.changes,
      );
      TableStructureSaveDialogService.close(true);
    } catch (error) {
      setErrorMessage(
        formatTableStructureSaveError(error, t("app.tableStructure.saveFailed")),
      );
      setExecuting(false);
    }
  }

  const { changes } = request;
  const added = changes.columns.filter((c) => c.op === "add");
  const dropped = changes.columns.filter((c) => c.op === "drop");
  const modified = changes.columns.filter((c) => c.op === "alter");

  return (
    <div
      className="explorer-mutation-dialog__backdrop"
      role="presentation"
      {...backdropDismiss}
    >
      <div
        className="explorer-mutation-dialog plsql-snapshot-dialog--diff plsql-save-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="table-structure-save-dialog-title"
      >
        <header className="explorer-mutation-dialog__header">
          <h2 id="table-structure-save-dialog-title">{t("app.tableStructure.saveDialogTitle")}</h2>
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
            {t("app.tableStructure.saveDialogSummary").replace("{label}", request.objectLabel)}
          </p>

          <div className="plsql-save-dialog__tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={view === "changes"}
              className={`plsql-save-dialog__tab${
                view === "changes" ? " plsql-save-dialog__tab--active" : ""
              }`}
              disabled={executing}
              onClick={() => setView("changes")}
            >
              {t("app.tableStructure.changesTab")}
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
              {t("app.tableStructure.sqlTab")}
            </button>
          </div>

          {view === "changes" ? (
            <div className="table-structure-save-dialog__changes">
              {changes.isEmpty ? (
                <p className="explorer-mutation-dialog__hint">{t("app.tableStructure.noChanges")}</p>
              ) : null}
              {changes.tableRename || changes.tableComment ? (
                <div className="table-structure-save-dialog__group">
                  <h3 className="table-structure-save-dialog__group-title">
                    {t("app.tableStructure.tableSection")}
                  </h3>
                  <div className="table-structure-save-dialog__entry">
                    {renderFieldChange("name", changes.tableRename)}
                    {renderFieldChange("comment", changes.tableComment)}
                  </div>
                </div>
              ) : null}
              {added.length > 0 ? (
                <div className="table-structure-save-dialog__group">
                  <h3 className="table-structure-save-dialog__group-title">
                    {t("app.tableStructure.addedSection")}
                  </h3>
                  {added.map((change) => (
                    <ChangeEntry key={change.rowId} change={change} />
                  ))}
                </div>
              ) : null}
              {dropped.length > 0 ? (
                <div className="table-structure-save-dialog__group">
                  <h3 className="table-structure-save-dialog__group-title">
                    {t("app.tableStructure.droppedSection")}
                  </h3>
                  {dropped.map((change) => (
                    <ChangeEntry key={change.rowId} change={change} />
                  ))}
                </div>
              ) : null}
              {modified.length > 0 ? (
                <div className="table-structure-save-dialog__group">
                  <h3 className="table-structure-save-dialog__group-title">
                    {t("app.tableStructure.modifiedSection")}
                  </h3>
                  {modified.map((change) => (
                    <ChangeEntry key={change.rowId} change={change} />
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <>
              <p className="explorer-mutation-dialog__hint">
                Review the SQL below. Nothing is written until you confirm.
              </p>
              <pre className="explorer-mutation-dialog__sql">{request.sql}</pre>
            </>
          )}

          {request.blockers.length > 0 ? (
            <ul
              className="explorer-mutation-dialog__hint table-structure-save-dialog__blockers"
              role="alert"
            >
              <li>{t("app.tableStructure.blockersTitle")}</li>
              {request.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
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
            disabled={executing || request.blockers.length > 0}
            onClick={() => void handleConfirm()}
          >
            {executing ? t("app.tableStructure.saving") : t("app.tableStructure.confirmButton")}
          </button>
        </footer>
      </div>
    </div>
  );
}

export default TableStructureSaveDialog;
