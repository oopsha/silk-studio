import { useEffect, useMemo, useState } from "react";
import { DiffEditor } from "@monaco-editor/react";
import type { Monaco } from "@monaco-editor/react";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { getEditorFontFamily } from "@silk-studio/ui/platform/fontDefaults.ts";
import { useConfiguration } from "@silk-studio/workbench/platform/configuration/useConfiguration.ts";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import {
  defineWorkbenchMonacoThemes,
  monacoThemeForColorTheme,
} from "@silk-studio/editor/themes/dark2026-monaco.ts";
import { PlsqlSnapshotDialogService } from "../../services/connection/plsqlSnapshotDialogService";
import {
  formatPlsqlSnapshotError,
  formatSnapshotTimestamp,
  listPlsqlSnapshots,
  openPlsqlRollbackConfirm,
  openPlsqlSnapshotDiff,
  reloadPlsqlFromDatabase,
  rollbackPlsqlSnapshot,
} from "../../services/connection/plsqlSnapshotService";
import type { PlsqlSnapshotEntry } from "../../services/connection/plsqlSnapshotStorage";
import { registerSqlLanguages } from "../../services/sql/registerSqlLanguages";
import "../connections/ExplorerObjectMutationDialog.css";
import "./PlsqlSnapshotDialog.css";

function PlsqlSnapshotDialog() {
  const { t } = useI18n();
  const [request, setRequest] = useState(() =>
    PlsqlSnapshotDialogService.getRequest(),
  );
  const [entries, setEntries] = useState<PlsqlSnapshotEntry[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const configuration = useConfiguration();

  useEffect(() => {
    return PlsqlSnapshotDialogService.onDidChange(() => {
      const next = PlsqlSnapshotDialogService.getRequest();
      setRequest(next);
      setErrorMessage(null);
      setBusy(false);
      if (next) {
        setEntries(listPlsqlSnapshots(next.ref));
      } else {
        setEntries([]);
      }
    });
  }, []);

  useEffect(() => {
    if (request?.mode === "history") {
      setEntries(listPlsqlSnapshots(request.ref));
    }
  }, [request?.mode, request?.ref]);

  const theme = monacoThemeForColorTheme(configuration["workbench.colorTheme"]);

  const title = useMemo(() => {
    if (!request) return "";
    if (request.mode === "diff") return t("app.plsql.compareWithSnapshot");
    if (request.mode === "confirm") {
      return request.confirmKind === "reload"
        ? t("app.plsql.reloadFromDatabase")
        : t("app.plsql.restoreSnapshot");
    }
    return t("app.plsql.snapshotDialogTitle");
  }, [request, t]);

  if (!request) {
    return null;
  }

  function close() {
    if (busy) return;
    PlsqlSnapshotDialogService.close();
  }

  function backToHistory() {
    if (busy || !request) return;
    PlsqlSnapshotDialogService.setMode("history", {
      bufferContent: request.bufferContent,
    });
  }

  async function handleConfirm() {
    if (!request || busy) return;
    setBusy(true);
    setErrorMessage(null);
    try {
      if (request.confirmKind === "reload") {
        await reloadPlsqlFromDatabase(request.tabId);
      } else if (request.confirmKind === "rollback" && request.snapshot) {
        rollbackPlsqlSnapshot(request.tabId, request.snapshot);
      }
      PlsqlSnapshotDialogService.close();
    } catch (error) {
      setErrorMessage(
        formatPlsqlSnapshotError(error, t("app.plsql.snapshotApplyFailed")),
      );
      setBusy(false);
    }
  }

  const handleBeforeMount = (monaco: Monaco) => {
    defineWorkbenchMonacoThemes(monaco);
    registerSqlLanguages(monaco);
  };

  return (
    <div
      className="explorer-mutation-dialog__backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) {
          close();
        }
      }}
    >
      <div
        className={`explorer-mutation-dialog plsql-snapshot-dialog${
          request.mode === "diff" ? " plsql-snapshot-dialog--diff" : ""
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="plsql-snapshot-dialog-title"
      >
        <header className="explorer-mutation-dialog__header">
          <h2 id="plsql-snapshot-dialog-title">{title}</h2>
          <button
            type="button"
            className="explorer-mutation-dialog__close"
            aria-label={t("common.close")}
            disabled={busy}
            onClick={close}
          >
            <Codicon name="close" />
          </button>
        </header>

        <div className="explorer-mutation-dialog__body plsql-snapshot-dialog__body">
          {request.mode === "history" ? (
            <>
              <p className="explorer-mutation-dialog__summary">
                Local history for <strong>{request.objectLabel}</strong>
              </p>
              <p className="explorer-mutation-dialog__hint">
                Snapshots are stored in this browser only (max 20 per object).
              </p>
              {entries.length === 0 ? (
                <p className="explorer-mutation-dialog__hint">
                  No snapshots yet. Save to the database or take a manual
                  snapshot.
                </p>
              ) : (
                <ul className="plsql-snapshot-dialog__list">
                  {entries.map((entry) => (
                    <li key={entry.id} className="plsql-snapshot-dialog__row">
                      <div className="plsql-snapshot-dialog__meta">
                        <span className="plsql-snapshot-dialog__when">
                          {formatSnapshotTimestamp(entry.createdAt)}
                        </span>
                        <span className="plsql-snapshot-dialog__reason">
                          {entry.reason === "save"
                            ? t("app.plsql.reasonSave")
                            : t("app.plsql.reasonManual")}
                        </span>
                      </div>
                      <div className="plsql-snapshot-dialog__row-actions">
                        <button
                          type="button"
                          className="explorer-mutation-dialog__button"
                          disabled={busy}
                          onClick={() =>
                            openPlsqlSnapshotDiff(entry, request.tabId)
                          }
                        >
                          Diff
                        </button>
                        <button
                          type="button"
                          className="explorer-mutation-dialog__button explorer-mutation-dialog__button--primary"
                          disabled={busy}
                          onClick={() =>
                            openPlsqlRollbackConfirm(entry, request.tabId)
                          }
                        >
                          {t("app.plsql.restore")}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : null}

          {request.mode === "diff" && request.snapshot ? (
            <>
              <p className="explorer-mutation-dialog__hint">
                Left: snapshot ({formatSnapshotTimestamp(request.snapshot.createdAt)})
                · Right: current buffer
              </p>
              <div className="plsql-snapshot-dialog__diff">
                <DiffEditor
                  height="100%"
                  language="plsql"
                  original={request.snapshot.content}
                  modified={request.bufferContent}
                  theme={theme}
                  beforeMount={handleBeforeMount}
                  options={{
                    readOnly: true,
                    renderSideBySide: true,
                    fontFamily: getEditorFontFamily(),
                    fontSize: configuration["editor.fontSize"],
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                  }}
                />
              </div>
            </>
          ) : null}

          {request.mode === "confirm" ? (
            <p className="explorer-mutation-dialog__summary">
              {request.confirmKind === "reload" ? (
                <>
                  Discard the current buffer for{" "}
                  <strong>{request.objectLabel}</strong> and reload source from
                  the database?
                </>
              ) : (
                <>
                  Replace the current buffer with the snapshot from{" "}
                  <strong>
                    {request.snapshot
                      ? formatSnapshotTimestamp(request.snapshot.createdAt)
                      : ""}
                  </strong>
                  ? The tab will be marked dirty until you save.
                </>
              )}
            </p>
          ) : null}

          {errorMessage ? (
            <p className="explorer-mutation-dialog__error" role="alert">
              {errorMessage}
            </p>
          ) : null}
        </div>

        <footer className="explorer-mutation-dialog__footer">
          {request.mode === "history" ? (
            <button
              type="button"
              className="explorer-mutation-dialog__button"
              disabled={busy}
              onClick={close}
            >
              {t("common.close")}
            </button>
          ) : null}

          {request.mode === "diff" ? (
            <>
              <button
                type="button"
                className="explorer-mutation-dialog__button"
                disabled={busy}
                onClick={backToHistory}
              >
                {t("workbench.commands.back")}
              </button>
              <button
                type="button"
                className="explorer-mutation-dialog__button explorer-mutation-dialog__button--primary"
                disabled={busy || !request.snapshot}
                onClick={() => {
                  if (request.snapshot) {
                    openPlsqlRollbackConfirm(request.snapshot, request.tabId);
                  }
                }}
              >
                {t("app.plsql.restoreSnapshot")}
              </button>
            </>
          ) : null}

          {request.mode === "confirm" ? (
            <>
              <button
                type="button"
                className="explorer-mutation-dialog__button"
                disabled={busy}
                onClick={() => {
                  if (request.confirmKind === "rollback") {
                    backToHistory();
                  } else {
                    close();
                  }
                }}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className={`explorer-mutation-dialog__button${
                  request.confirmKind === "reload"
                    ? " explorer-mutation-dialog__button--danger"
                    : " explorer-mutation-dialog__button--primary"
                }`}
                disabled={busy}
                onClick={() => void handleConfirm()}
              >
                {busy
                  ? t("common.working")
                  : request.confirmKind === "reload"
                    ? t("app.plsql.reload")
                    : t("app.plsql.restore")}
              </button>
            </>
          ) : null}
        </footer>
      </div>
    </div>
  );
}

export default PlsqlSnapshotDialog;
