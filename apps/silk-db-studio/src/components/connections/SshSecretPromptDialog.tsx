import { useEffect, useRef, useState } from "react";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { useBackdropDismiss } from "@silk-studio/ui/hooks/useBackdropDismiss.ts";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import type { MessageKey } from "@silk-studio/workbench/platform/i18n/i18nService.ts";
import { SshSecretPromptService } from "../../services/connection/sshSecretPromptService";
import type { SshSecretKind } from "../../services/connection/sshTunnelSecretBridge";
import "./ExplorerObjectMutationDialog.css";
import "./ConnectionPasswordPromptDialog.css";

const FIELD_LABEL_KEY: Record<SshSecretKind, MessageKey> = {
  password: "app.connection.sshSecretLabelPassword",
  passphrase: "app.connection.sshSecretLabelPassphrase",
  targetPassword: "app.connection.sshSecretLabelTargetPassword",
  targetPassphrase: "app.connection.sshSecretLabelTargetPassphrase",
};

function close() {
  SshSecretPromptService.close({ confirmed: false });
}

function SshSecretPromptDialog() {
  const { t } = useI18n();
  const [request, setRequest] = useState(() => SshSecretPromptService.getRequest());
  const [values, setValues] = useState<Partial<Record<SshSecretKind, string>>>({});
  const [save, setSave] = useState(true);
  const firstInputRef = useRef<HTMLInputElement | null>(null);
  const backdropDismiss = useBackdropDismiss(close);

  useEffect(() => {
    return SshSecretPromptService.onDidChange(() => {
      setRequest(SshSecretPromptService.getRequest());
      setValues({});
      setSave(true);
    });
  }, []);

  useEffect(() => {
    if (!request) return;
    const frameId = requestAnimationFrame(() => firstInputRef.current?.focus());
    return () => cancelAnimationFrame(frameId);
  }, [request]);

  if (!request) {
    return null;
  }

  // Unlike the DB password prompt, these fields are optional: a private key isn't necessarily
  // passphrase-protected, and there's no way to know ahead of a connect attempt — same reasoning
  // the Connection Editor's own passphrase field (always visible, never required) already follows.
  function confirm() {
    SshSecretPromptService.close({ confirmed: true, values, save });
  }

  return (
    <div className="explorer-mutation-dialog__backdrop" role="presentation" {...backdropDismiss}>
      <div
        className="explorer-mutation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ssh-secret-prompt-title"
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            confirm();
          }
        }}
      >
        <header className="explorer-mutation-dialog__header">
          <h2 id="ssh-secret-prompt-title">{t("app.connection.sshSecretPromptTitle")}</h2>
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
            {t("app.connection.sshSecretPromptSummary").replace("{name}", request.profileName)}
          </p>
          {request.fields.map((field, index) => (
            <label key={field} className="explorer-mutation-dialog__field">
              <span className="explorer-mutation-dialog__field-label">
                {t(FIELD_LABEL_KEY[field])}
              </span>
              <input
                ref={index === 0 ? firstInputRef : undefined}
                className="explorer-mutation-dialog__input"
                type="password"
                autoComplete="off"
                value={values[field] ?? ""}
                onChange={(event) =>
                  setValues((prev) => ({ ...prev, [field]: event.target.value }))
                }
              />
            </label>
          ))}
          <label className="connection-password-prompt__save">
            <input
              type="checkbox"
              checked={save}
              onChange={(event) => setSave(event.target.checked)}
            />
            <span>{t("app.connection.sshSecretPromptSave")}</span>
          </label>
        </div>

        <footer className="explorer-mutation-dialog__footer">
          <button type="button" className="explorer-mutation-dialog__button" onClick={close}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="explorer-mutation-dialog__button explorer-mutation-dialog__button--primary"
            onClick={confirm}
          >
            {t("common.connect")}
          </button>
        </footer>
      </div>
    </div>
  );
}

export default SshSecretPromptDialog;
