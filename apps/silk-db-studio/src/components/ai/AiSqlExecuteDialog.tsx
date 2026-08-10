import { useEffect, useState } from "react";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { useBackdropDismiss } from "@silk-studio/ui/hooks/useBackdropDismiss.ts";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import { AiSqlExecuteDialogService } from "../../services/ai/aiSqlExecuteDialogService";
import "../connections/ExplorerObjectMutationDialog.css";
import "./AiSqlExecuteDialog.css";

function close() {
  AiSqlExecuteDialogService.close(false);
}

function AiSqlExecuteDialog() {
  const { t } = useI18n();
  const [request, setRequest] = useState(() =>
    AiSqlExecuteDialogService.getRequest(),
  );
  const [writeAck, setWriteAck] = useState(false);
  const backdropDismiss = useBackdropDismiss(close);

  useEffect(() => {
    return AiSqlExecuteDialogService.onDidChange(() => {
      setRequest(AiSqlExecuteDialogService.getRequest());
      setWriteAck(false);
    });
  }, []);

  if (!request) {
    return null;
  }

  const blocked = Boolean(request.blockedReason);
  const needsWriteAck = request.isWrite && !blocked;
  const canConfirm = !blocked && (!needsWriteAck || writeAck);

  return (
    <div
      className="explorer-mutation-dialog__backdrop"
      role="presentation"
      {...backdropDismiss}
    >
      <div
        className="explorer-mutation-dialog ai-sql-execute-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-sql-execute-dialog-title"
      >
        <header className="explorer-mutation-dialog__header">
          <h2 id="ai-sql-execute-dialog-title">
            {t("app.ai.executeDialogTitle")}
          </h2>
          <button
            type="button"
            className="explorer-mutation-dialog__close"
            aria-label={t("common.close")}
            onClick={close}
          >
            <Codicon name="close" />
          </button>
        </header>

        <div className="explorer-mutation-dialog__body">
          <p className="explorer-mutation-dialog__summary">
            {t("app.ai.executeDialogSummary")}
          </p>
          <pre className="explorer-mutation-dialog__sql">{request.sql}</pre>

          {request.warnings.length > 0 ? (
            <ul className="explorer-mutation-dialog__hint" role="status">
              {request.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}

          {request.blockedReason ? (
            <p className="explorer-mutation-dialog__error" role="alert">
              {request.blockedReason}
            </p>
          ) : null}

          {needsWriteAck ? (
            <label className="ai-sql-execute-dialog__ack">
              <input
                type="checkbox"
                checked={writeAck}
                onChange={(event) => setWriteAck(event.target.checked)}
              />
              <span>{t("app.ai.writeAck")}</span>
            </label>
          ) : null}
        </div>

        <footer className="explorer-mutation-dialog__footer">
          <button
            type="button"
            className="explorer-mutation-dialog__button"
            onClick={close}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className={`explorer-mutation-dialog__button${
              request.isWrite
                ? " explorer-mutation-dialog__button--danger"
                : " explorer-mutation-dialog__button--primary"
            }`}
            disabled={!canConfirm}
            onClick={() => AiSqlExecuteDialogService.close(true)}
          >
            {request.isWrite ? t("app.ai.executeWrite") : t("common.execute")}
          </button>
        </footer>
      </div>
    </div>
  );
}

export default AiSqlExecuteDialog;
