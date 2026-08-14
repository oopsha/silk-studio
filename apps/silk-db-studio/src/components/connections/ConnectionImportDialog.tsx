import { useEffect, useState } from "react";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { useBackdropDismiss } from "@silk-studio/ui/hooks/useBackdropDismiss.ts";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import { ConnectionImportDialogService } from "../../services/connection/connectionImportDialogService";
import "./ExplorerObjectMutationDialog.css";
import "./ConnectionImportDialog.css";

function close() {
  ConnectionImportDialogService.close({ confirmed: false });
}

function ConnectionImportDialog() {
  const { t } = useI18n();
  const [request, setRequest] = useState(() =>
    ConnectionImportDialogService.getRequest(),
  );
  const [selectedIndexes, setSelectedIndexes] = useState<Set<number>>(new Set());

  useEffect(() => {
    return ConnectionImportDialogService.onDidChange(() => {
      const next = ConnectionImportDialogService.getRequest();
      setRequest(next);
      setSelectedIndexes(new Set(next?.candidates.map((c) => c.index) ?? []));
    });
  }, []);

  const backdropDismiss = useBackdropDismiss(close);

  if (!request) {
    return null;
  }

  const candidates = request.candidates;
  const allSelected = selectedIndexes.size === candidates.length;
  const canSubmit = selectedIndexes.size > 0;

  function toggle(index: number) {
    setSelectedIndexes((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIndexes(
      allSelected ? new Set() : new Set(candidates.map((c) => c.index)),
    );
  }

  function confirm() {
    if (!canSubmit) return;
    ConnectionImportDialogService.close({
      confirmed: true,
      indexes: Array.from(selectedIndexes),
    });
  }

  function tunnelLabel(tunnel: "none" | "ssm" | "ssh"): string {
    switch (tunnel) {
      case "ssm":
        return t("app.connection.importTunnelSsm");
      case "ssh":
        return t("app.connection.importTunnelSsh");
      default:
        return t("app.connection.importTunnelNone");
    }
  }

  return (
    <div
      className="explorer-mutation-dialog__backdrop"
      role="presentation"
      {...backdropDismiss}
    >
      <div
        className="explorer-mutation-dialog connection-import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="connection-import-dialog-title"
      >
        <header className="explorer-mutation-dialog__header">
          <h2 id="connection-import-dialog-title">
            {t("app.connection.importTitle")}
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
            {t("app.connection.importDialogSummary").replace(
              "{n}",
              String(candidates.length),
            )}
          </p>

          <label className="connection-import-dialog__item connection-import-dialog__item--all">
            <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
            <span>{t("app.connection.exportSelectAll")}</span>
          </label>

          <div className="connection-import-dialog__list">
            {candidates.map((candidate) => (
              <label key={candidate.index} className="connection-import-dialog__item">
                <input
                  type="checkbox"
                  checked={selectedIndexes.has(candidate.index)}
                  onChange={() => toggle(candidate.index)}
                />
                <div className="connection-import-dialog__item-body">
                  <div className="connection-import-dialog__item-title">
                    <span className="connection-import-dialog__item-name">
                      {candidate.name}
                    </span>
                    <span className="connection-import-dialog__item-driver">
                      {candidate.driverLabel}
                    </span>
                    {candidate.tunnel !== "none" ? (
                      <span className="connection-import-dialog__badge connection-import-dialog__badge--tunnel">
                        {tunnelLabel(candidate.tunnel)}
                      </span>
                    ) : null}
                    {candidate.nameConflict ? (
                      <span className="connection-import-dialog__badge connection-import-dialog__badge--warn">
                        {t("app.connection.importNameConflict")}
                      </span>
                    ) : null}
                    {candidate.connectionConflict ? (
                      <span className="connection-import-dialog__badge connection-import-dialog__badge--warn">
                        {t("app.connection.importConnectionConflict")}
                      </span>
                    ) : null}
                  </div>
                  <div className="connection-import-dialog__item-detail">
                    {candidate.hostPort}
                    {candidate.database ? ` / ${candidate.database}` : ""}
                    {candidate.user ? ` · ${candidate.user}` : ""}
                  </div>
                </div>
              </label>
            ))}
          </div>
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
            className="explorer-mutation-dialog__button explorer-mutation-dialog__button--primary"
            disabled={!canSubmit}
            onClick={confirm}
          >
            {t("app.connection.importTitle")}
          </button>
        </footer>
      </div>
    </div>
  );
}

export default ConnectionImportDialog;
