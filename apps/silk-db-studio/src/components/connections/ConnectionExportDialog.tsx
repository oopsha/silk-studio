import { useEffect, useState } from "react";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { useBackdropDismiss } from "@silk-studio/ui/hooks/useBackdropDismiss.ts";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import { ConnectionExportDialogService } from "../../services/connection/connectionExportDialogService";
import "./ExplorerObjectMutationDialog.css";
import "./ConnectionExportDialog.css";

type ExportScope = "all" | "select";

function close() {
  ConnectionExportDialogService.close({ confirmed: false });
}

function ConnectionExportDialog() {
  const { t } = useI18n();
  const [request, setRequest] = useState(() =>
    ConnectionExportDialogService.getRequest(),
  );
  const [scope, setScope] = useState<ExportScope>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const backdropDismiss = useBackdropDismiss(close);

  useEffect(() => {
    return ConnectionExportDialogService.onDidChange(() => {
      const next = ConnectionExportDialogService.getRequest();
      setRequest(next);
      setScope("all");
      setSelectedIds(new Set(next?.profiles.map((profile) => profile.id) ?? []));
    });
  }, []);

  if (!request) {
    return null;
  }

  const profiles = request.profiles;
  const allSelected = selectedIds.size === profiles.length;
  const canSubmit = scope === "all" || selectedIds.size > 0;

  function toggleProfile(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds(allSelected ? new Set() : new Set(profiles.map((p) => p.id)));
  }

  function confirm() {
    if (!canSubmit) return;
    const profileIds =
      scope === "all" ? profiles.map((profile) => profile.id) : Array.from(selectedIds);
    ConnectionExportDialogService.close({ confirmed: true, profileIds });
  }

  return (
    <div
      className="explorer-mutation-dialog__backdrop"
      role="presentation"
      {...backdropDismiss}
    >
      <div
        className="explorer-mutation-dialog connection-export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="connection-export-dialog-title"
      >
        <header className="explorer-mutation-dialog__header">
          <h2 id="connection-export-dialog-title">
            {t("app.connection.exportTitle")}
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
          <label className="connection-export-dialog__radio">
            <input
              type="radio"
              name="connection-export-scope"
              checked={scope === "all"}
              onChange={() => setScope("all")}
            />
            <span>{t("app.connection.exportScopeAll")}</span>
          </label>
          <label className="connection-export-dialog__radio">
            <input
              type="radio"
              name="connection-export-scope"
              checked={scope === "select"}
              onChange={() => setScope("select")}
            />
            <span>{t("app.connection.exportScopeSelect")}</span>
          </label>

          {scope === "select" ? (
            <div className="connection-export-dialog__list">
              <label className="connection-export-dialog__item connection-export-dialog__item--all">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                />
                <span>{t("app.connection.exportSelectAll")}</span>
              </label>
              {profiles.map((profile) => (
                <label key={profile.id} className="connection-export-dialog__item">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(profile.id)}
                    onChange={() => toggleProfile(profile.id)}
                  />
                  <span>{profile.name}</span>
                  <span className="connection-export-dialog__item-driver">
                    {profile.driverId}
                  </span>
                </label>
              ))}
            </div>
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
            className="explorer-mutation-dialog__button explorer-mutation-dialog__button--primary"
            disabled={!canSubmit}
            onClick={confirm}
          >
            {t("app.connection.exportTitle")}
          </button>
        </footer>
      </div>
    </div>
  );
}

export default ConnectionExportDialog;
