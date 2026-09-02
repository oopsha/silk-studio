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
} from "@silk-studio/editor/themes/dark-monaco.ts";
import { PackagePlsqlHistoryDialogService } from "../../services/connection/packagePlsqlHistoryDialogService";
import {
  clearAllPackagePlsqlSnapshots,
  deletePackagePlsqlSnapshotEntry,
  formatPlsqlSnapshotError,
  formatSnapshotTimestamp,
  listPackagePlsqlSnapshots,
} from "../../services/connection/plsqlSnapshotService";
import type { PackagePlsqlSnapshotEntry } from "../../services/connection/plsqlSnapshotStorage";
import { registerSqlLanguages } from "../../services/sql/registerSqlLanguages";
import "../connections/ExplorerObjectMutationDialog.css";
import "./PlsqlSnapshotDialog.css";
import "./PlsqlSaveDialog.css";

type Section = "spec" | "body";

type View =
  | { mode: "history" }
  | { mode: "diff"; entry: PackagePlsqlSnapshotEntry; section: Section }
  | { mode: "confirm"; kind: "restore" | "delete" | "clearAll"; entry?: PackagePlsqlSnapshotEntry };

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

/**
 * Package Spec/Body snapshot history. A snapshot entry always covers both halves together
 * (mirrors Save/Compare&Save's "always both" behavior) — separate storage
 * (`PackagePlsqlSnapshotEntry`) and its own dialog since the single-buffer `PlsqlSnapshotDialog`
 * hardcodes a `tabId`-based restore/reload flow the package local-buffer editor doesn't have
 * (see PackagePlsqlHistoryDialogService's doc comment).
 */
function PackagePlsqlHistoryDialog() {
  const { t } = useI18n();
  const [request, setRequest] = useState(() =>
    PackagePlsqlHistoryDialogService.getRequest(),
  );
  const [view, setView] = useState<View>({ mode: "history" });
  const [entries, setEntries] = useState<PackagePlsqlSnapshotEntry[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const configuration = useConfiguration();

  function close() {
    if (busy) return;
    PackagePlsqlHistoryDialogService.close();
  }

  const backdropDismiss = useBackdropDismiss(close, !busy);

  useEffect(() => {
    return PackagePlsqlHistoryDialogService.onDidChange(() => {
      const next = PackagePlsqlHistoryDialogService.getRequest();
      setRequest(next);
      setView({ mode: "history" });
      setErrorMessage(null);
      setBusy(false);
      setEntries(next ? listPackagePlsqlSnapshots(next.ref) : []);
    });
  }, []);

  const theme = monacoThemeForColorTheme(configuration["workbench.colorTheme"]);

  const title = useMemo(() => {
    if (view.mode === "diff") return t("app.plsql.compareWithSnapshot");
    if (view.mode === "confirm") {
      if (view.kind === "delete") return t("app.plsql.deleteSnapshot");
      if (view.kind === "clearAll") return t("app.plsql.clearAllSnapshots");
      return t("app.plsql.restoreSnapshot");
    }
    return t("app.plsql.snapshotDialogTitle");
  }, [view, t]);

  if (!request) {
    return null;
  }

  function refreshEntries() {
    if (!request) return;
    setEntries(listPackagePlsqlSnapshots(request.ref));
  }

  async function handleConfirm() {
    if (!request || busy || view.mode !== "confirm") return;
    setBusy(true);
    setErrorMessage(null);
    try {
      if (view.kind === "restore" && view.entry) {
        request.onRestore(view.entry.spec, view.entry.body);
        PackagePlsqlHistoryDialogService.close();
        return;
      }
      if (view.kind === "delete" && view.entry) {
        deletePackagePlsqlSnapshotEntry(request.ref, view.entry.id);
        refreshEntries();
        setView({ mode: "history" });
        setBusy(false);
        return;
      }
      if (view.kind === "clearAll") {
        clearAllPackagePlsqlSnapshots(request.ref);
        refreshEntries();
        setView({ mode: "history" });
        setBusy(false);
        return;
      }
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

  const confirmSummary =
    view.mode === "confirm"
      ? view.kind === "delete"
        ? renderTemplateWithStrong(
            t("app.plsql.deleteConfirm"),
            "{time}",
            view.entry ? formatSnapshotTimestamp(view.entry.createdAt) : "",
          )
        : view.kind === "clearAll"
          ? renderTemplateWithStrong(
              t("app.plsql.clearAllConfirm"),
              "{label}",
              request.objectLabel,
            )
          : renderTemplateWithStrong(
              t("app.plsql.restoreConfirm"),
              "{time}",
              view.entry ? formatSnapshotTimestamp(view.entry.createdAt) : "",
            )
      : null;

  const confirmPrimaryLabel =
    view.mode === "confirm" && (view.kind === "delete" || view.kind === "clearAll")
      ? t("common.delete")
      : t("app.plsql.restore");

  const confirmIsDanger =
    view.mode === "confirm" && (view.kind === "delete" || view.kind === "clearAll");

  return (
    <div
      className="explorer-mutation-dialog__backdrop"
      role="presentation"
      {...backdropDismiss}
    >
      <div
        className={`explorer-mutation-dialog plsql-snapshot-dialog${
          view.mode === "diff" ? " plsql-snapshot-dialog--diff" : ""
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="package-plsql-history-dialog-title"
      >
        <header className="explorer-mutation-dialog__header">
          <h2 id="package-plsql-history-dialog-title">{title}</h2>
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
          {view.mode === "history" ? (
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
                      onClick={() => setView({ mode: "confirm", kind: "clearAll" })}
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
                            onClick={() => setView({ mode: "diff", entry, section: "spec" })}
                          >
                            {t("app.plsql.diff")}
                          </button>
                          <button
                            type="button"
                            className="explorer-mutation-dialog__button explorer-mutation-dialog__button--primary"
                            disabled={busy}
                            onClick={() =>
                              setView({ mode: "confirm", kind: "restore", entry })
                            }
                          >
                            {t("app.plsql.restore")}
                          </button>
                          <button
                            type="button"
                            className="explorer-mutation-dialog__button explorer-mutation-dialog__button--danger"
                            disabled={busy}
                            onClick={() =>
                              setView({ mode: "confirm", kind: "delete", entry })
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

          {view.mode === "diff" ? (
            <>
              <p className="explorer-mutation-dialog__hint">
                {t("app.plsql.diffHint").replace(
                  "{time}",
                  formatSnapshotTimestamp(view.entry.createdAt),
                )}
              </p>
              <div className="plsql-save-dialog__tabs" role="tablist">
                {(["spec", "body"] as const).map((section) => (
                  <button
                    key={section}
                    type="button"
                    role="tab"
                    aria-selected={section === view.section}
                    className={`plsql-save-dialog__tab${
                      section === view.section ? " plsql-save-dialog__tab--active" : ""
                    }`}
                    onClick={() =>
                      setView((prev) =>
                        prev.mode === "diff" ? { ...prev, section } : prev,
                      )
                    }
                  >
                    {section === "spec"
                      ? t("app.objectEditor.specSection")
                      : t("app.objectEditor.bodySection")}
                  </button>
                ))}
              </div>
              <div className="plsql-snapshot-dialog__diff">
                <DiffEditor
                  height="100%"
                  language="plsql"
                  original={view.entry[view.section]}
                  modified={
                    view.section === "spec"
                      ? request.currentSpecContent
                      : request.currentBodyContent
                  }
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

          {view.mode === "confirm" ? (
            <p className="explorer-mutation-dialog__summary">{confirmSummary}</p>
          ) : null}

          {errorMessage ? (
            <p className="explorer-mutation-dialog__error" role="alert">
              {errorMessage}
            </p>
          ) : null}
        </div>

        <footer className="explorer-mutation-dialog__footer">
          {view.mode === "history" ? (
            <button
              type="button"
              className="explorer-mutation-dialog__button"
              disabled={busy}
              onClick={close}
            >
              {t("common.close")}
            </button>
          ) : null}

          {view.mode === "diff" ? (
            <>
              <button
                type="button"
                className="explorer-mutation-dialog__button"
                disabled={busy}
                onClick={() => setView({ mode: "history" })}
              >
                {t("workbench.commands.back")}
              </button>
              <button
                type="button"
                className="explorer-mutation-dialog__button explorer-mutation-dialog__button--primary"
                disabled={busy}
                onClick={() =>
                  setView({ mode: "confirm", kind: "restore", entry: view.entry })
                }
              >
                {t("app.plsql.restoreSnapshot")}
              </button>
            </>
          ) : null}

          {view.mode === "confirm" ? (
            <>
              <button
                type="button"
                className="explorer-mutation-dialog__button"
                disabled={busy}
                onClick={() => setView({ mode: "history" })}
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

export default PackagePlsqlHistoryDialog;
