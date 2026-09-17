import { useEffect, useState } from "react";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { useBackdropDismiss } from "@silk-studio/ui/hooks/useBackdropDismiss.ts";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import { fetchQueryResultPage } from "../../../services/query/queryResultPaging";
import type { QueryResultPayload } from "../../../services/query/queryResult";
import {
  CURRENT_TIMESTAMP_VALUE,
  isCurrentTimestampValue,
} from "../../../services/query/queryResultTemporalValue";
import {
  MaskedTemporalInput,
  isCompleteTemporalValue,
  type TemporalEditorKind,
} from "./MaskedTemporalInput";
import "./QueryResultValueEditorDialog.css";

type QueryResultValueEditorDialogProps = {
  column: string;
  columnIndex: number;
  rowIndex: number;
  value: string | null;
  valueIsTruncated: boolean;
  editorKind: "text" | TemporalEditorKind;
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
  editorKind,
  result,
  sql,
  binds,
  connectionId,
  onCancel,
  onSave,
}: QueryResultValueEditorDialogProps) {
  const { t } = useI18n();
  const [text, setText] = useState(value ?? "");
  const [isNull, setIsNull] = useState(value === null);
  const [loading, setLoading] = useState(valueIsTruncated && Boolean(connectionId));
  const [loadError, setLoadError] = useState<string | null>(null);
  const isCurrentTime = !isNull && isCurrentTimestampValue(text);
  const isTemporalValueValid = isNull || editorKind === "text" || isCurrentTime || isCompleteTemporalValue(text, editorKind);
  const canSave = !loading && isTemporalValueValid && !(valueIsTruncated && (!connectionId || loadError));
  const backdropDismiss = useBackdropDismiss(onCancel, !loading);

  useEffect(() => {
    setText(value ?? "");
    setIsNull(value === null);
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
        const loadedValue = payload.rows[0]?.[columnIndex] ?? null;
        setText(loadedValue ?? "");
        setIsNull(loadedValue === null);
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
      <div className={`query-result-value-editor${editorKind === "text" ? "" : " query-result-value-editor--temporal"}`} role="dialog" aria-modal="true" aria-labelledby="query-result-value-editor-title">
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
          {isNull ? <p className="query-result-value-editor__current-time">NULL</p> : editorKind === "text" ? (
            <textarea
              className="query-result-value-editor__textarea"
              value={text}
              disabled={loading}
              autoFocus
              spellCheck={false}
              onChange={(event) => {
                setIsNull(false);
                setText(event.target.value);
              }}
            />
          ) : (
            isCurrentTime ? <p className="query-result-value-editor__current-time">{t("app.query.currentTimeValue")}</p> : (
              <MaskedTemporalInput
                key={`${column}:${rowIndex}:${editorKind}`}
                kind={editorKind}
                value={text}
                disabled={loading}
                autoFocus
                onChange={(nextValue) => {
                  setIsNull(false);
                  setText(nextValue);
                }}
              />
            )
          )}
        </div>
        <footer className="query-result-value-editor__footer">
          <button type="button" className="query-result-value-editor__button" disabled={loading} onClick={onCancel}>{t("common.cancel")}</button>
          <button type="button" className="query-result-value-editor__button" disabled={loading} onClick={() => { setIsNull(false); setText(""); }}>{t("app.query.setEmptyValue")}</button>
          <button type="button" className="query-result-value-editor__button" disabled={loading} onClick={() => { setIsNull(true); setText(""); }}>{t("app.query.setNullValue")}</button>
          {editorKind !== "text" ? <button type="button" className="query-result-value-editor__button" disabled={loading} onClick={() => { setIsNull(false); setText(CURRENT_TIMESTAMP_VALUE); }}>{t("app.query.setCurrentTime")}</button> : null}
          <button type="button" className="query-result-value-editor__button query-result-value-editor__button--primary" disabled={!canSave} onClick={() => onSave(isNull ? null : text)}>{t("common.save")}</button>
        </footer>
      </div>
    </div>
  );
}

export default QueryResultValueEditorDialog;
