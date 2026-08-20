import { useEffect, useMemo, useState } from "react";
import { DiffEditor } from "@monaco-editor/react";
import type { Monaco } from "@monaco-editor/react";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { useBackdropDismiss } from "@silk-studio/ui/hooks/useBackdropDismiss.ts";
import { getEditorFontFamily } from "@silk-studio/ui/platform/fontDefaults.ts";
import { useConfiguration } from "@silk-studio/workbench/platform/configuration/useConfiguration.ts";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import {
  defineWorkbenchMonacoThemes,
  monacoThemeForColorTheme,
} from "@silk-studio/editor/themes/dark2026-monaco.ts";
import { PlsqlSnapshotDialogService } from "../../services/connection/plsqlSnapshotDialogService";
import {
  clearAllPlsqlSnapshots,
  deletePlsqlSnapshotEntry,
  formatPlsqlSnapshotError,
  formatSnapshotTimestamp,
  listPlsqlSnapshots,
  openPlsqlClearAllConfirm,
  openPlsqlDeleteConfirm,
  openPlsqlRollbackConfirm,
  openPlsqlSnapshotDiff,
  reloadPlsqlFromDatabase,
  rollbackPlsqlSnapshot,
} from "../../services/connection/plsqlSnapshotService";
import type { PlsqlSnapshotEntry } from "../../services/connection/plsqlSnapshotStorage";
import { registerSqlLanguages } from "../../services/sql/registerSqlLanguages";
import "../connections/ExplorerObjectMutationDialog.css";
import "./PlsqlSnapshotDialog.css";

function renderTemplateWithStrong(
  template: string,
  placeholder: "{label}" | "{time}",
  value: string,
) {
  const parts = template.split(placeholder);
  if (parts.length < 2) {
    return template.replace(placeholder, value);
  }
  return (
    <>
      {parts[0]}
      <strong>{value}</strong>
      {parts.slice(1).join(placeholder)}
    </>
  );
}

function PlsqlSnapshotDialog() {
  const { t } = useI18n();
  const [request, setRequest] = useState(() =>
    PlsqlSnapshotDialogService.getRequest(),
  );
  const [entries, setEntries] = useState<PlsqlSnapshotEntry[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const configuration = useConfiguration();

  function close() {
    if (busy) return;
    PlsqlSnapshotDialogService.close();
  }

  const backdropDismiss = useBackdropDismiss(close, !busy);

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
      if (request.confirmKind === "reload") {
        return t("app.plsql.reloadFromDatabase");
      }
      if (request.confirmKind === "delete") {
        return t("app.plsql.deleteSnapshot");
      }
      if (request.confirmKind === "clearAll") {
        return t("app.plsql.clearAllSnapshots");
      }
      return t("app.plsql.restoreSnapshot");
    }
    return t("app.plsql.snapshotDialogTitle");
  }, [request, t]);

  if (!request) {
    return null;
  }

  function backToHistory() {
    if (busy || !request) return;
    PlsqlSnapshotDialogService.setMode("history", {
      bufferContent: request.bufferContent,
      snapshot: undefined,
      confirmKind: undefined,
    });
  }

  function refreshEntries() {
    if (!request) return;
    setEntries(listPlsqlSnapshots(request.ref));
  }

  async function handleConfirm() {
    if (!request || busy) return;
    setBusy(true);
    setErrorMessage(null);
    try {
      if (request.confirmKind === "reload") {
        await reloadPlsqlFromDatabase(request.tabId);
        PlsqlSnapshotDialogService.close();
        return;
      }
      if (request.confirmKind === "rollback" && request.snapshot) {
        rollbackPlsqlSnapshot(request.tabId, request.snapshot);
        PlsqlSnapshotDialogService.close();
        return;
      }
      if (request.confirmKind === "delete" && request.snapshot) {
        deletePlsqlSnapshotEntry(request.ref, request.snapshot.id);
        refreshEntries();
        backToHistory();
        return;
      }
      if (request.confirmKind === "clearAll") {
        clearAllPlsqlSnapshots(request.ref);
        refreshEntries();
        backToHistory();
        return;
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

  const confirmSummary = (() => {
    if (request.mode !== "confirm") return null;
    if (request.confirmKind === "reload") {
      return renderTemplateWithStrong(
        t("app.plsql.reloadConfirm"),
        "{label}",
        request.objectLabel,
      );
    }
    if (request.confirmKind === "delete") {
      return renderTemplateWithStrong(
        t("app.plsql.deleteConfirm"),
        "{time}",
        request.snapshot
          ? formatSnapshotTimestamp(request.snapshot.createdAt)
          : "",
      );
    }
    if (request.confirmKind === "clearAll") {
      return renderTemplateWithStrong(
        t("app.plsql.clearAllConfirm"),
        "{label}",
        request.objectLabel,
      );
    }
    return renderTemplateWithStrong(
      t("app.plsql.restoreConfirm"),
      "{time}",
      request.snapshot
        ? formatSnapshotTimestamp(request.snapshot.createdAt)
        : "",
    );
  })();

  const confirmPrimaryLabel =
    request.confirmKind === "reload"
      ? t("app.plsql.reload")
      : request.confirmKind === "delete" || request.confirmKind === "clearAll"
        ? t("common.delete")
        : t("app.plsql.restore");

  const confirmIsDanger =
    request.confirmKind === "reload" ||
    request.confirmKind === "delete" ||
    request.confirmKind === "clearAll";

  return (
    <div
      className="explorer-mutation-dialog__backdrop"
      role="presentation"
      {...backdropDismiss}
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
                {renderTemplateWithStrong(
                  t("app.plsql.historyForObject"),
                  "{label}",
                  request.objectLabel,
                )}
              </p>
              <p className="explorer-mutation-dialog__hint">
                {t("app.plsql.snapshotsBrowserOnly")}
              </p>
              {entries.length === 0 ? (
                <p className="explorer-mutation-dialog__hint">
                  {t("app.plsql.noSnapshotsYet")}
                </p>
              ) : (
                <>
                  <div className="plsql-snapshot-dialog__toolbar">
                    <button
                      type="button"
                      className="explorer-mutation-dialog__button"
                      disabled={busy}
                      onClick={() => openPlsqlClearAllConfirm(request.tabId)}
                    >
                      {t("app.plsql.clearAllSnapshots")}
                    </button>
                  </div>
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
                              : entry.reason === "compile"
                                ? t("app.plsql.reasonCompile")
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
                            {t("app.plsql.diff")}
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
                          <button
                            type="button"
                            className="explorer-mutation-dialog__button explorer-mutation-dialog__button--danger"
                            disabled={busy}
                            onClick={() =>
                              openPlsqlDeleteConfirm(entry, request.tabId)
                            }
                          >
                            {t("common.delete")}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          ) : null}

          {request.mode === "diff" && request.snapshot ? (
            <>
              <p className="explorer-mutation-dialog__hint">
                {t("app.plsql.diffHint").replace(
                  "{time}",
                  formatSnapshotTimestamp(request.snapshot.createdAt),
                )}
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
            <p className="explorer-mutation-dialog__summary">{confirmSummary}</p>
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
                  if (request.confirmKind === "reload") {
                    close();
                  } else {
                    backToHistory();
                  }
                }}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className={`explorer-mutation-dialog__button${
                  confirmIsDanger
                    ? " explorer-mutation-dialog__button--danger"
                    : " explorer-mutation-dialog__button--primary"
                }`}
                disabled={busy}
                onClick={() => void handleConfirm()}
              >
                {busy ? t("common.working") : confirmPrimaryLabel}
              </button>
            </>
          ) : null}
        </footer>
      </div>
    </div>
  );
}

export default PlsqlSnapshotDialog;
