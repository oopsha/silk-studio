import { useEffect, useState } from "react";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { useBackdropDismiss } from "@silk-studio/ui/hooks/useBackdropDismiss.ts";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import { ConfirmDialogService } from "../../services/ui/confirmDialogService";
import "../connections/ExplorerObjectMutationDialog.css";
import "./ConfirmDialog.css";

/**
 * Generic in-app confirm dialog. See `confirmDialogService.ts`'s doc comment for why this
 * exists instead of `window.confirm` — reuses `ExplorerObjectMutationDialog.css`'s classes so
 * it looks native to the rest of the app's modal dialogs.
 */
function ConfirmDialog() {
  const { t } = useI18n();
  const [request, setRequest] = useState(() => ConfirmDialogService.getRequest());

  useEffect(() => {
    return ConfirmDialogService.onDidChange(() => {
      setRequest(ConfirmDialogService.getRequest());
    });
  }, []);

  function close(confirmed: boolean) {
    ConfirmDialogService.close(confirmed);
  }

  const backdropDismiss = useBackdropDismiss(() => close(false), true);

  if (!request) {
    return null;
  }

  return (
    <div
      className="explorer-mutation-dialog__backdrop"
      role="presentation"
      {...backdropDismiss}
    >
      <div
        className="explorer-mutation-dialog confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
      >
        <header className="explorer-mutation-dialog__header">
          <h2 id="confirm-dialog-title">{request.title}</h2>
          <button
            type="button"
            className="explorer-mutation-dialog__close"
            aria-label={t("common.close")}
            onClick={() => close(false)}
          >
            <Codicon name="close" />
          </button>
        </header>

        <div className="explorer-mutation-dialog__body">
          <p className="explorer-mutation-dialog__summary">{request.message}</p>
        </div>

        <footer className="explorer-mutation-dialog__footer">
          <button
            type="button"
            className="explorer-mutation-dialog__button"
            autoFocus
            onClick={() => close(false)}
          >
            {request.cancelLabel ?? t("common.cancel")}
          </button>
          <button
            type="button"
            className={`explorer-mutation-dialog__button${
              request.danger
                ? " explorer-mutation-dialog__button--danger"
                : " explorer-mutation-dialog__button--primary"
            }`}
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
