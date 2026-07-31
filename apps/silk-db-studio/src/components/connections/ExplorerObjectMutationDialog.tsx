import { useEffect, useMemo, useRef, useState } from "react";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import { ExplorerObjectMutationDialogService } from "../../services/connection/explorerObjectMutationDialogService";
import {
  executeExplorerMutation,
  formatMutationError,
  previewDropSql,
  previewRenameSql,
} from "../../services/connection/explorerObjectMutationService";
import { formatQualifiedName } from "../../services/connection/explorerObjectActions";
import "./ExplorerObjectMutationDialog.css";

function ExplorerObjectMutationDialog() {
  const { t } = useI18n();
  const [request, setRequest] = useState(() =>
    ExplorerObjectMutationDialogService.getRequest(),
  );
  const [newName, setNewName] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return ExplorerObjectMutationDialogService.onDidChange(() => {
      const next = ExplorerObjectMutationDialogService.getRequest();
      setRequest(next);
      setNewName("");
      setErrorMessage(null);
      setExecuting(false);
    });
  }, []);

  useEffect(() => {
    if (!request || request.mode !== "rename") return;
    const frameId = requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
    return () => cancelAnimationFrame(frameId);
  }, [request]);

  const qualifiedLabel = request
    ? formatQualifiedName(request.ref.schemaName, request.ref.object.name)
    : "";

  const previewSql = useMemo(() => {
    if (!request) return "";
    try {
      if (request.mode === "drop") {
        return previewDropSql(request.ref, request.driverId);
      }
      return previewRenameSql(request.ref, request.driverId, newName);
    } catch (error) {
      return `-- ${formatMutationError(error, t("app.explorer.invalidRename"))}`;
    }
  }, [request, newName, t]);

  const previewError = useMemo(() => {
    if (!request || request.mode !== "rename" || !newName.trim()) {
      return null;
    }
    try {
      previewRenameSql(request.ref, request.driverId, newName);
      return null;
    } catch (error) {
      return formatMutationError(error, t("app.explorer.invalidRename"));
    }
  }, [request, newName, t]);

  if (!request) {
    return null;
  }

  const isDrop = request.mode === "drop";
  const canConfirm =
    isDrop ||
    (newName.trim().length > 0 &&
      newName.trim() !== request.ref.object.name &&
      !previewError);

  function close() {
    if (executing) return;
    ExplorerObjectMutationDialogService.close();
  }

  async function handleConfirm() {
    if (!request || !canConfirm || executing) return;
    const current = request;
    setExecuting(true);
    setErrorMessage(null);
    try {
      await executeExplorerMutation(
        current.ref,
        current.driverId,
        current.mode,
        current.mode === "rename" ? newName : undefined,
      );
      ExplorerObjectMutationDialogService.close();
    } catch (error) {
      setErrorMessage(formatMutationError(error, t("app.explorer.executeFailed")));
      setExecuting(false);
    }
  }

  return (
    <div
      className="explorer-mutation-dialog__backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget && !executing) {
          close();
        }
      }}
    >
      <div
        className="explorer-mutation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="explorer-mutation-dialog-title"
      >
        <header className="explorer-mutation-dialog__header">
          <h2 id="explorer-mutation-dialog-title">
            {isDrop
              ? t("app.explorer.confirmDrop")
              : t("app.explorer.renameObject")}
          </h2>
          <button
            type="button"
            className="explorer-mutation-dialog__close"
            aria-label={t("common.close")}
            disabled={executing}
            onClick={close}
          >
            <Codicon name="close" />
          </button>
        </header>

        <div className="explorer-mutation-dialog__body">
          {isDrop ? (
            <p className="explorer-mutation-dialog__summary">
              {t("app.explorer.dropSummary").replace("{name}", qualifiedLabel)}
            </p>
          ) : (
            <>
              <p className="explorer-mutation-dialog__summary">
                {t("app.explorer.renameSummary").replace(
                  "{name}",
                  qualifiedLabel,
                )}
              </p>
              <label className="explorer-mutation-dialog__field">
                <span className="explorer-mutation-dialog__field-label">
                  {t("app.explorer.newName")}
                </span>
                <input
                  ref={renameInputRef}
                  type="text"
                  className="explorer-mutation-dialog__input"
                  value={newName}
                  spellCheck={false}
                  autoComplete="off"
                  disabled={executing}
                  onChange={(event) => setNewName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && canConfirm) {
                      event.preventDefault();
                      void handleConfirm();
                    }
                  }}
                />
              </label>
            </>
          )}

          <p className="explorer-mutation-dialog__hint">
            {t("app.explorer.mutationHint")}
          </p>
          <pre className="explorer-mutation-dialog__sql">{previewSql}</pre>
          {previewError && request.mode === "rename" ? (
            <p className="explorer-mutation-dialog__error" role="alert">
              {previewError}
            </p>
          ) : null}
          {errorMessage ? (
            <p className="explorer-mutation-dialog__error" role="alert">
              {errorMessage}
            </p>
          ) : null}
        </div>

        <footer className="explorer-mutation-dialog__footer">
          <button
            type="button"
            className="explorer-mutation-dialog__button"
            disabled={executing}
            onClick={close}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className={`explorer-mutation-dialog__button${
              isDrop
                ? " explorer-mutation-dialog__button--danger"
                : " explorer-mutation-dialog__button--primary"
            }`}
            disabled={executing || !canConfirm}
            onClick={() => void handleConfirm()}
          >
            {executing
              ? t("common.executing")
              : isDrop
                ? t("app.explorer.executeDrop")
                : t("app.explorer.executeRename")}
          </button>
        </footer>
      </div>
    </div>
  );
}

export default ExplorerObjectMutationDialog;
