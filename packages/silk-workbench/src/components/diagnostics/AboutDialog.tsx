import { useEffect, useState } from "react";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
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
        error instanceof Error ? error.message : "Failed to open log folder.",
        "error",
      );
    }
  }

  const appVersion = runtime?.appVersion ?? APP_VERSION;
  const tauriVersion = runtime?.tauriVersion ?? "…";
  const agentLabel = loading
    ? "…"
    : runtime
      ? `${runtime.agentJarPresent ? "present" : "missing"}${
          runtime.agentBundled ? " · bundled" : " · dev"
        }`
      : "unknown";
  const javaLabel = loading
    ? "…"
    : runtime
      ? `${runtime.javaBundled ? "bundled JRE" : "system/PATH"} (${runtime.javaBinPath})`
      : "unknown";

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
          <h2 id="about-dialog-title">About {APP_DISPLAY_NAME}</h2>
          <button
            type="button"
            className="about-dialog__close"
            aria-label="Close"
            onClick={close}
          >
            <Codicon name="close" />
          </button>
        </header>

        <div className="about-dialog__body">
          <p className="about-dialog__product">{APP_DISPLAY_NAME}</p>
          <dl className="about-dialog__meta">
            <div>
              <dt>Version</dt>
              <dd>{appVersion}</dd>
            </div>
            <div>
              <dt>Tauri</dt>
              <dd>{loading ? "…" : tauriVersion}</dd>
            </div>
            <div>
              <dt>jdbc-agent</dt>
              <dd>{agentLabel}</dd>
            </div>
            <div>
              <dt>Java</dt>
              <dd className="about-dialog__path">{javaLabel}</dd>
            </div>
            <div>
              <dt>OS</dt>
              <dd>
                {loading
                  ? "…"
                  : `${runtime?.os ?? "unknown"} / ${runtime?.arch ?? "unknown"}`}
              </dd>
            </div>
            <div>
              <dt>Log file</dt>
              <dd className="about-dialog__path">
                {loading ? "…" : (runtime?.logFile ?? "(unavailable)")}
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
            Open Log Folder
          </button>
          <button
            type="button"
            className="about-dialog__button"
            onClick={close}
          >
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}

export default AboutDialog;
