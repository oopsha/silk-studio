import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
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
          <h2 id="query-result-update-dialog-title">Confirm UPDATE</h2>
          <button
            type="button"
            className="query-result-update-dialog__close"
            aria-label="Close"
            disabled={executing}
            onClick={onCancel}
          >
            <Codicon name="close" />
          </button>
        </header>

        <div className="query-result-update-dialog__body">
          <p className="query-result-update-dialog__summary">
            Save {dirtyCellCount} edited cell{dirtyCellCount === 1 ? "" : "s"} across{" "}
            {dirtyRowCount} row{dirtyRowCount === 1 ? "" : "s"} on{" "}
            <strong>{tableLabel}</strong>?
          </p>
          <p className="query-result-update-dialog__hint">
            Review the generated SQL below. Nothing is written until you confirm.
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
            Cancel
          </button>
          <button
            type="button"
            className="query-result-update-dialog__button query-result-update-dialog__button--primary"
            disabled={executing || statements.length === 0}
            onClick={onConfirm}
          >
            {executing ? "Executing…" : "Execute UPDATE"}
          </button>
        </footer>
      </div>
    </div>
  );
}

export default QueryResultUpdateDialog;
