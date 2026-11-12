import { useEffect, useState } from "react";
import { useBackdropDismiss } from "@silk-studio/ui/hooks/useBackdropDismiss.ts";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import type { ConnectionImportSource } from "../../services/connection/externalConnectionImport";
import { ConnectionImportSourceDialogService } from "../../services/connection/connectionImportSourceDialogService";
import "./ExplorerObjectMutationDialog.css";
import "./ConnectionImportSourceDialog.css";

function close() {
  ConnectionImportSourceDialogService.close(null);
}

function ConnectionImportSourceDialog() {
  const { t } = useI18n();
  const [visible, setVisible] = useState(() =>
    ConnectionImportSourceDialogService.isVisible(),
  );

  useEffect(() => {
    return ConnectionImportSourceDialogService.onDidChange(() => {
      setVisible(ConnectionImportSourceDialogService.isVisible());
    });
  }, []);

  const backdropDismiss = useBackdropDismiss(close);
  if (!visible) return null;

  const sources: Array<{
    id: ConnectionImportSource;
    title: string;
    description: string;
  }> = [
    {
      id: "Silk",
      title: t("app.connection.importSourceSilk"),
      description: t("app.connection.importSourceSilkDescription"),
    },
    {
      id: "DBeaver",
      title: t("app.connection.importSourceDBeaver"),
      description: t("app.connection.importSourceDBeaverDescription"),
    },
    {
      id: "DataGrip",
      title: t("app.connection.importSourceDataGrip"),
      description: t("app.connection.importSourceDataGripDescription"),
    },
  ];

  return (
    <div
      className="explorer-mutation-dialog__backdrop"
      role="presentation"
      {...backdropDismiss}
    >
      <section
        className="explorer-mutation-dialog connection-import-source-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="connection-import-source-title"
      >
        <header className="explorer-mutation-dialog__header">
          <h2 id="connection-import-source-title">{t("app.connection.importTitle")}</h2>
        </header>
        <div className="explorer-mutation-dialog__body">
          <p className="explorer-mutation-dialog__summary">
            {t("app.connection.importSourceSummary")}
          </p>
          <div className="connection-import-source-dialog__options">
            {sources.map((source) => (
              <button
                key={source.id}
                type="button"
                className="connection-import-source-dialog__option"
                onClick={() => ConnectionImportSourceDialogService.close(source.id)}
              >
                <span className="connection-import-source-dialog__option-title">
                  {source.title}
                </span>
                <span className="connection-import-source-dialog__option-description">
                  {source.description}
                </span>
              </button>
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
        </footer>
      </section>
    </div>
  );
}

export default ConnectionImportSourceDialog;
