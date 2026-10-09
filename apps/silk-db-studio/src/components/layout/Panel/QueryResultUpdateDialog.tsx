import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { useBackdropDismiss } from "@silk-studio/ui/hooks/useBackdropDismiss.ts";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import { AppNotificationService } from "@silk-studio/workbench/services/notifications/appNotificationService.ts";
import "./QueryResultUpdateDialog.css";

type QueryResultUpdateDialogProps = {
  tableLabel: string;
  dirtyRowCount: number;
  dirtyCellCount: number;
  deletedRowCount: number;
  insertedRowCount: number;
  truncateRequested: boolean;
  showSqlPreview: boolean;
  statements: string[];
  hasExecutableChanges: boolean;
  errorMessage: string | null;
  executing: boolean;
  progress: { completed: number; total: number } | null;
  onCancel: () => void;
  onConfirm: () => void;
};

function QueryResultUpdateDialog({
  tableLabel,
  dirtyRowCount,
  dirtyCellCount,
  deletedRowCount,
  insertedRowCount,
  truncateRequested,
  showSqlPreview,
  statements,
  hasExecutableChanges,
  errorMessage,
  executing,
  progress,
  onCancel,
  onConfirm,
}: QueryResultUpdateDialogProps) {
  const { t } = useI18n();
  const sqlText = showSqlPreview ? statements.join("\n\n") : "";
  const backdropDismiss = useBackdropDismiss(onCancel, !executing);
  const hasInserts = insertedRowCount > 0;
  const hasUpdates = dirtyRowCount > 0;
  const hasDeletes = deletedRowCount > 0;
  const hasTruncate = truncateRequested;
  const kindCount = [hasInserts, hasUpdates, hasDeletes, hasTruncate].filter(Boolean).length;
  const titleKey =
    kindCount > 1
      ? "app.query.confirmChangesTitle"
      : hasTruncate
        ? "app.query.confirmTruncateTitle"
      : hasInserts
        ? "app.query.confirmInsertTitle"
        : hasDeletes
          ? "app.query.confirmDeleteTitle"
          : "app.query.confirmUpdateTitle";
  const confirmKey =
    kindCount > 1
      ? "app.query.executeChanges"
      : hasTruncate
        ? "app.query.executeTruncate"
      : hasInserts
        ? "app.query.executeInsert"
        : hasDeletes
          ? "app.query.executeDelete"
          : "app.query.executeUpdate";

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(sqlText);
      AppNotificationService.show(t("app.query.sqlCopied"), "success");
    } catch (error) {
      console.warn("[query-result-update-dialog] copy sql failed", error);
      AppNotificationService.show(t("app.query.copyFailed"), "error");
    }
  };

  return (
    <div
      className="query-result-update-dialog__backdrop"
      role="presentation"
      {...backdropDismiss}
    >
      <div
        className="query-result-update-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="query-result-update-dialog-title"
      >
        <header className="query-result-update-dialog__header">
          <h2 id="query-result-update-dialog-title">
            {t(titleKey)}
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
          {truncateRequested ? (
            <p className="query-result-update-dialog__summary query-result-update-dialog__summary--danger">
              {t("app.query.confirmTruncateSummary").replace("{table}", tableLabel)}
            </p>
          ) : null}
          {insertedRowCount > 0 ? (
            <p className="query-result-update-dialog__summary">
              {t("app.query.confirmInsertSummary")
                .replace("{rows}", String(insertedRowCount))
                .replace("{table}", tableLabel)}
            </p>
          ) : null}
          {dirtyRowCount > 0 ? (
            <p className="query-result-update-dialog__summary">
              {t("app.query.confirmUpdateSummary")
                .replace("{cells}", String(dirtyCellCount))
                .replace("{rows}", String(dirtyRowCount))
                .replace("{table}", tableLabel)}
            </p>
          ) : null}
          {deletedRowCount > 0 ? (
            <p className="query-result-update-dialog__summary">
              {t("app.query.confirmDeleteSummary")
                .replace("{rows}", String(deletedRowCount))
                .replace("{table}", tableLabel)}
            </p>
          ) : null}
          <p className="query-result-update-dialog__hint">
            {t(showSqlPreview ? "app.query.confirmUpdateHint" : "app.query.bulkSqlPreviewHidden")}
          </p>
          {executing && progress ? (
            <div className="query-result-update-dialog__progress-status">
              <div
                className="query-result-update-dialog__progress-track"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={progress.total}
                aria-valuenow={progress.completed}
                aria-label={t("app.query.executingProgress")
                  .replace("{current}", String(progress.completed))
                  .replace("{total}", String(progress.total))}
              >
                <div
                  className="query-result-update-dialog__progress-value"
                  style={{ width: `${progress.total ? (progress.completed / progress.total) * 100 : 0}%` }}
                />
              </div>
              <span>
                {t("app.query.executingProgress")
                  .replace("{current}", String(progress.completed))
                  .replace("{total}", String(progress.total))}
              </span>
            </div>
          ) : null}
          {showSqlPreview ? <><div className="query-result-update-dialog__sql-toolbar">
            <button
              type="button"
              className="query-result-update-dialog__copy"
              disabled={!sqlText}
              onClick={() => void handleCopy()}
            >
              <Codicon name="copy" />
              {t("app.query.copySql")}
            </button>
          </div>
          <pre className="query-result-update-dialog__sql">{sqlText}</pre></> : null}
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
            disabled={executing || !hasExecutableChanges}
            onClick={onConfirm}
          >
            {executing ? t("common.executing") : t(confirmKey)}
          </button>
        </footer>
      </div>
    </div>
  );
}

export default QueryResultUpdateDialog;
