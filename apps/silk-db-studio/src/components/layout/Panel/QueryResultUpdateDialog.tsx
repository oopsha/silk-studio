import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import "./QueryResultUpdateDialog.css";

type QueryResultUpdateDialogProps = {
  tableLabel: string;
  dirtyRowCount: number;
  dirtyCellCount: number;
  statements: string[];
  errorMessage: string | null;
  executing: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

function QueryResultUpdateDialog({
  tableLabel,
  dirtyRowCount,
  dirtyCellCount,
  statements,
  errorMessage,
  executing,
  onCancel,
  onConfirm,
}: QueryResultUpdateDialogProps) {
  const { t } = useI18n();

  return (
    <div
      className="query-result-update-dialog__backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget && !executing) {
          onCancel();
        }
      }}
    >
      <div
        className="query-result-update-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="query-result-update-dialog-title"
      >
        <header className="query-result-update-dialog__header">
          <h2 id="query-result-update-dialog-title">
            {t("app.query.confirmUpdateTitle")}
          </h2>
          <button
            type="button"
            className="query-result-update-dialog__close"
            aria-label={t("common.close")}
            disabled={executing}
            onClick={onCancel}
          >
            <Codicon name="close" />
          </button>
        </header>

        <div className="query-result-update-dialog__body">
          <p className="query-result-update-dialog__summary">
            {t("app.query.confirmUpdateSummary")
              .replace("{cells}", String(dirtyCellCount))
              .replace("{rows}", String(dirtyRowCount))
              .replace("{table}", tableLabel)}
          </p>
          <p className="query-result-update-dialog__hint">
            {t("app.query.confirmUpdateHint")}
          </p>
          <pre className="query-result-update-dialog__sql">
            {statements.join("\n\n")}
          </pre>
          {errorMessage ? (
            <p className="query-result-update-dialog__error" role="alert">
              {errorMessage}
            </p>
          ) : null}
        </div>

        <footer className="query-result-update-dialog__footer">
          <button
            type="button"
            className="query-result-update-dialog__button"
            disabled={executing}
            onClick={onCancel}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="query-result-update-dialog__button query-result-update-dialog__button--primary"
            disabled={executing || statements.length === 0}
            onClick={onConfirm}
          >
            {executing ? t("common.executing") : t("app.query.executeUpdate")}
          </button>
        </footer>
      </div>
    </div>
  );
}

export default QueryResultUpdateDialog;
