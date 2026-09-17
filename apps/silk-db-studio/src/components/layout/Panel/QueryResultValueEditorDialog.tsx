import { useEffect, useState } from "react";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { useBackdropDismiss } from "@silk-studio/ui/hooks/useBackdropDismiss.ts";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import { fetchQueryResultPage } from "../../../services/query/queryResultPaging";
import type { QueryResultPayload } from "../../../services/query/queryResult";
import "./QueryResultValueEditorDialog.css";

type QueryResultValueEditorDialogProps = {
  column: string;
  columnIndex: number;
  rowIndex: number;
  value: string | null;
  valueIsTruncated: boolean;
  result: QueryResultPayload;
  sql: string;
  binds?: Array<string | null>;
  connectionId?: string;
  onCancel: () => void;
  onSave: (value: string | null) => void;
};

function QueryResultValueEditorDialog({
  column,
  columnIndex,
  rowIndex,
  value,
  valueIsTruncated,
  result,
  sql,
  binds,
  connectionId,
  onCancel,
  onSave,
}: QueryResultValueEditorDialogProps) {
  const { t } = useI18n();
  const [text, setText] = useState(value ?? "");
  const [loading, setLoading] = useState(valueIsTruncated && Boolean(connectionId));
  const [loadError, setLoadError] = useState<string | null>(null);
  const canSave = !loading && !(valueIsTruncated && (!connectionId || loadError));
  const backdropDismiss = useBackdropDismiss(onCancel, !loading);

  useEffect(() => {
    setText(value ?? "");
  }, [value]);

  useEffect(() => {
    if (!valueIsTruncated || !connectionId) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void fetchQueryResultPage(connectionId, sql, result.columns, rowIndex, 1, {
      binds,
      readFullLobs: true,
    })
      .then((payload) => {
        if (cancelled) return;
        setText(payload.rows[0]?.[columnIndex] ?? "");
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [binds, columnIndex, connectionId, result.columns, rowIndex, sql, valueIsTruncated]);

  return (
    <div className="query-result-value-editor__backdrop" role="presentation" {...backdropDismiss}>
      <div className="query-result-value-editor" role="dialog" aria-modal="true" aria-labelledby="query-result-value-editor-title">
        <header className="query-result-value-editor__header">
          <div>
            <h2 id="query-result-value-editor-title">{t("app.query.editValue")}</h2>
            <p>{column}</p>
          </div>
          <button type="button" className="query-result-value-editor__close" aria-label={t("common.close")} onClick={onCancel}>
            <Codicon name="close" />
          </button>
        </header>
        <div className="query-result-value-editor__body">
          {loading ? <p className="query-result-value-editor__hint">{t("app.query.loadingFullValue")}</p> : null}
          {loadError ? <p className="query-result-value-editor__error">{t("app.query.loadFullValueFailed").replace("{message}", loadError)}</p> : null}
          {valueIsTruncated && !connectionId ? <p className="query-result-value-editor__error">{t("app.query.fullValueUnavailable")}</p> : null}
          <textarea
            className="query-result-value-editor__textarea"
            value={text}
            disabled={loading}
            autoFocus
            spellCheck={false}
            onChange={(event) => setText(event.target.value)}
          />
        </div>
        <footer className="query-result-value-editor__footer">
          <button type="button" className="query-result-value-editor__button" disabled={loading} onClick={onCancel}>{t("common.cancel")}</button>
          <button type="button" className="query-result-value-editor__button query-result-value-editor__button--primary" disabled={!canSave} onClick={() => onSave(text)}>{t("common.save")}</button>
        </footer>
      </div>
    </div>
  );
}

export default QueryResultValueEditorDialog;
