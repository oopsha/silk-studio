import { useEffect, useRef, useState } from "react";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { useBackdropDismiss } from "@silk-studio/ui/hooks/useBackdropDismiss.ts";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import { ConnectionPasswordPromptService } from "../../services/connection/connectionPasswordPromptService";
import "./ExplorerObjectMutationDialog.css";
import "./ConnectionPasswordPromptDialog.css";

function close() {
  ConnectionPasswordPromptService.close({ confirmed: false });
}

function ConnectionPasswordPromptDialog() {
  const { t } = useI18n();
  const [request, setRequest] = useState(() =>
    ConnectionPasswordPromptService.getRequest(),
  );
  const [password, setPassword] = useState("");
  const [save, setSave] = useState(true);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const backdropDismiss = useBackdropDismiss(close);

  useEffect(() => {
    return ConnectionPasswordPromptService.onDidChange(() => {
      setRequest(ConnectionPasswordPromptService.getRequest());
      setPassword("");
      setSave(true);
    });
  }, []);

  useEffect(() => {
    if (!request) return;
    const frameId = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frameId);
  }, [request]);

  if (!request) {
    return null;
  }

  function confirm() {
    if (!password) return;
    ConnectionPasswordPromptService.close({ confirmed: true, password, save });
  }

  return (
    <div
      className="explorer-mutation-dialog__backdrop"
      role="presentation"
      {...backdropDismiss}
    >
      <div
        className="explorer-mutation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="connection-password-prompt-title"
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            confirm();
          }
        }}
      >
        <header className="explorer-mutation-dialog__header">
          <h2 id="connection-password-prompt-title">
            {t("app.connection.passwordPromptTitle")}
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
            {t("app.connection.passwordPromptSummary").replace(
              "{name}",
              request.profileName,
            )}
          </p>
          <label className="explorer-mutation-dialog__field">
            <span className="explorer-mutation-dialog__field-label">
              {t("app.connection.password")}
            </span>
            <input
              ref={inputRef}
              className="explorer-mutation-dialog__input"
              type="password"
              autoComplete="off"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label className="connection-password-prompt__save">
            <input
              type="checkbox"
              checked={save}
              onChange={(event) => setSave(event.target.checked)}
            />
            <span>{t("app.connection.passwordPromptSave")}</span>
          </label>
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
            disabled={!password}
            onClick={confirm}
          >
            {t("common.connect")}
          </button>
        </footer>
      </div>
    </div>
  );
}

export default ConnectionPasswordPromptDialog;
