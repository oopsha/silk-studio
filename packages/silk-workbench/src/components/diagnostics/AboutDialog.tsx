import { useEffect, useState } from "react";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { useI18n } from "../../platform/i18n/useI18n";
import { CommandService } from "../../platform/commands/commandService";
import { AboutDialogService } from "../../services/diagnostics/aboutDialogService";
import {
  APP_DISPLAY_NAME,
  APP_VERSION,
  type AppRuntimeInfo,
} from "../../services/diagnostics/appVersion";
import {
  fetchAppRuntimeInfo,
  openLogFolder,
} from "../../services/diagnostics/diagnosticsService";
import { AppNotificationService } from "../../services/notifications/appNotificationService";
import "./AboutDialog.css";

function AboutDialog() {
  const { t } = useI18n();
  const [open, setOpen] = useState(() => AboutDialogService.isOpen());
  const [runtime, setRuntime] = useState<AppRuntimeInfo | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    return AboutDialogService.onDidChange(() => {
      setOpen(AboutDialogService.isOpen());
    });
  }, []);

  useEffect(() => {
    if (!open) {
      setRuntime(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    void fetchAppRuntimeInfo().then((info) => {
      if (cancelled) return;
      setRuntime(info);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) {
    return null;
  }

  function close() {
    AboutDialogService.close();
  }

  async function handleOpenLogFolder() {
    try {
      await openLogFolder();
    } catch (error) {
      AppNotificationService.show(
        error instanceof Error
          ? error.message
          : t("workbench.about.openLogFailed"),
        "error",
      );
    }
  }

  const appVersion = runtime?.appVersion ?? APP_VERSION;
  const tauriVersion = runtime?.tauriVersion ?? "…";
  const agentLabel = loading
    ? "…"
    : runtime
      ? `${runtime.agentJarPresent ? t("workbench.about.present") : t("workbench.about.missing")}${
          runtime.agentBundled
            ? ` · ${t("workbench.about.bundled")}`
            : ` · ${t("workbench.about.dev")}`
        }`
      : t("workbench.about.unknown");
  const javaLabel = loading
    ? "…"
    : runtime
      ? `${runtime.javaBundled ? t("workbench.about.bundledJre") : t("workbench.about.systemPath")} (${runtime.javaBinPath})`
      : t("workbench.about.unknown");

  return (
    <div
      className="about-dialog__backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          close();
        }
      }}
    >
      <div
        className="about-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-dialog-title"
      >
        <header className="about-dialog__header">
          <h2 id="about-dialog-title">
            {t("workbench.about.title").replace("{name}", APP_DISPLAY_NAME)}
          </h2>
          <button
            type="button"
            className="about-dialog__close"
            aria-label={t("common.close")}
            onClick={close}
          >
            <Codicon name="close" />
          </button>
        </header>

        <div className="about-dialog__body">
          <p className="about-dialog__product">{APP_DISPLAY_NAME}</p>
          <dl className="about-dialog__meta">
            <div>
              <dt>{t("workbench.about.version")}</dt>
              <dd>{appVersion}</dd>
            </div>
            <div>
              <dt>{t("workbench.about.tauri")}</dt>
              <dd>{loading ? "…" : tauriVersion}</dd>
            </div>
            <div>
              <dt>{t("workbench.about.jdbcAgent")}</dt>
              <dd>{agentLabel}</dd>
            </div>
            <div>
              <dt>{t("workbench.about.java")}</dt>
              <dd className="about-dialog__path">{javaLabel}</dd>
            </div>
            <div>
              <dt>{t("workbench.about.os")}</dt>
              <dd>
                {loading
                  ? "…"
                  : `${runtime?.os ?? t("workbench.about.unknown")} / ${runtime?.arch ?? t("workbench.about.unknown")}`}
              </dd>
            </div>
            <div>
              <dt>{t("workbench.about.logFile")}</dt>
              <dd className="about-dialog__path">
                {loading
                  ? "…"
                  : (runtime?.logFile ?? t("workbench.about.unavailable"))}
              </dd>
            </div>
          </dl>
        </div>

        <footer className="about-dialog__footer">
          <button
            type="button"
            className="about-dialog__button about-dialog__button--secondary"
            onClick={() => void handleOpenLogFolder()}
          >
            {t("workbench.commands.openLogFolder")}
          </button>
          <button
            type="button"
            className="about-dialog__button about-dialog__button--secondary"
            onClick={() => {
              close();
              void CommandService.executeCommand("silk.ai.showCallLog");
            }}
          >
            {t("workbench.commands.showAiCallLog")}
          </button>
          <button
            type="button"
            className="about-dialog__button"
            onClick={close}
          >
            {t("common.close")}
          </button>
        </footer>
      </div>
    </div>
  );
}

export default AboutDialog;
