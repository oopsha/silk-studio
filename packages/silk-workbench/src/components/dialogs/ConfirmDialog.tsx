import { useEffect, useState } from "react";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { useBackdropDismiss } from "@silk-studio/ui/hooks/useBackdropDismiss.ts";
import { useI18n } from "../../platform/i18n/useI18n.ts";
import { ConfirmDialogService } from "../../services/dialog/confirmDialogService.ts";
import "./ConfirmDialog.css";

function ConfirmDialog() {
  const { t } = useI18n();
  const [request, setRequest] = useState(() => ConfirmDialogService.getRequest());

  useEffect(
    () =>
      ConfirmDialogService.onDidChange(() => {
        setRequest(ConfirmDialogService.getRequest());
      }),
    [],
  );

  const close = (confirmed: boolean) => ConfirmDialogService.close(confirmed);
  const backdropDismiss = useBackdropDismiss(() => close(false), true);

  if (!request) return null;

  return (
    <div
      className="workbench-confirm-dialog__backdrop"
      role="presentation"
      {...backdropDismiss}
    >
      <div
        className="workbench-confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="workbench-confirm-dialog-title"
      >
        <header className="workbench-confirm-dialog__header">
          <h2 id="workbench-confirm-dialog-title">{request.title}</h2>
          <button
            type="button"
            className="workbench-confirm-dialog__close"
            aria-label={t("common.close")}
            onClick={() => close(false)}
          >
            <Codicon name="close" />
          </button>
        </header>
        <div className="workbench-confirm-dialog__body">
          <p>{request.message}</p>
        </div>
        <footer className="workbench-confirm-dialog__footer">
          <button
            type="button"
            className="workbench-confirm-dialog__button"
            autoFocus
            onClick={() => close(false)}
          >
            {request.cancelLabel ?? t("common.cancel")}
          </button>
          <button
            type="button"
            className={`workbench-confirm-dialog__button workbench-confirm-dialog__button--${request.danger ? "danger" : "primary"}`}
            onClick={() => close(true)}
          >
            {request.confirmLabel ?? t("common.delete")}
          </button>
        </footer>
      </div>
    </div>
  );
}

export default ConfirmDialog;
