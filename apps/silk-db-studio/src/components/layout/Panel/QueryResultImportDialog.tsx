import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import type { ParsedImportSource } from "../../../services/query/queryResultImport";
import { importCell, validateImport, type EmptyCellPolicy, type FileImportPlan } from "../../../services/query/fileImportPlan";
import { executeFileImport, type ImportProgress, type ImportTarget } from "../../../services/query/fileImportService";
import { formatErrorMessage } from "../../../services/formatErrorMessage";

type Props = {
  filename: string;
  targetColumns: string[];
  target: ImportTarget;
  source: ParsedImportSource;
  initialTruncate: boolean;
  onCancel: () => void;
  onImported: () => void;
};

function defaultMapping(headers: string[], columns: string[], hasHeader: boolean): Record<string, number> {
  return Object.fromEntries(columns.map((column, index) => [column, hasHeader
    ? headers.findIndex((header) => header.trim().toLowerCase() === column.toLowerCase())
    : index < headers.length ? index : -1]));
}

export default function QueryResultImportDialog({ filename, targetColumns, target, source, initialTruncate, onCancel, onImported }: Props) {
  const { t } = useI18n();
  const [headerStartRow, setHeaderStartRow] = useState(0);
  const [headerEndRow, setHeaderEndRow] = useState(0);
  const [clearExisting, setClearExisting] = useState(initialTruncate);
  const [sheetIndex, setSheetIndex] = useState(() => source.kind === "workbook"
    ? Math.max(0, source.sheets.findIndex((sheet) => sheet.rows.length > 0)) : 0);
  const [defaultEmpty, setDefaultEmpty] = useState<EmptyCellPolicy>({ kind: "null" });
  const [overrides, setOverrides] = useState<Record<string, EmptyCellPolicy | undefined>>({});
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState<{ completed: number; pendingCommit: boolean } | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const sourceRows = source.kind === "workbook" ? source.sheets[sheetIndex]?.rows ?? [] : source.parsed.rows;
  const columnCount = useMemo(() => sourceRows.reduce((max, row) => Math.max(max, row.length), 0), [sourceRows]);
  const hasHeader = sourceRows.length > 0 && headerStartRow >= 0;
  const start = Math.min(Math.max(headerStartRow, 0), Math.max(0, sourceRows.length - 1));
  const end = Math.min(Math.max(headerEndRow, start), Math.max(0, sourceRows.length - 1));
  const sourceHeaders = useMemo(() => Array.from({ length: columnCount }, (_, index) => {
    if (!hasHeader) return `Column ${index + 1}`;
    const parts = sourceRows.slice(start, end + 1).map((row) => row[index]?.trim() ?? "")
      .filter(Boolean).filter((value, position, values) => values.indexOf(value) === position);
    return parts.join(" / ") || `Column ${index + 1}`;
  }), [columnCount, hasHeader, start, end, sourceRows]);
  const dataRows = useMemo(() => sourceRows.slice(hasHeader ? end + 1 : 0), [sourceRows, hasHeader, end]);
  const [mapping, setMapping] = useState(() => defaultMapping(sourceHeaders, targetColumns, hasHeader));
  useEffect(() => { setMapping(defaultMapping(sourceHeaders, targetColumns, hasHeader)); }, [sourceHeaders, targetColumns, hasHeader]);
  const plan = useMemo<FileImportPlan>(() => ({
    columns: targetColumns.filter((column) => mapping[column] >= 0).map((name) => ({
      name, sourceIndex: mapping[name], empty: overrides[name] ?? defaultEmpty,
    })), rows: dataRows, firstFileRow: hasHeader ? end + 2 : 1, clearExisting,
  }), [mapping, overrides, defaultEmpty, dataRows, hasHeader, end, clearExisting, targetColumns]);
  const issues = useMemo(() => validateImport(plan, target.columns, target.driverId === "oracle"), [plan, target]);
  const emptyCounts = useMemo(() => Object.fromEntries(targetColumns.map((column) => [column,
    mapping[column] >= 0 ? dataRows.reduce((count, row) => count + ((row[mapping[column]] ?? "") === "" ? 1 : 0), 0) : 0,
  ])), [dataRows, mapping, targetColumns]);
  const policyOptions = <>
    <option value="null">SQL NULL</option>
    <option value="empty">{t("app.query.importEmptyString")}</option>
    <option value="value">{t("app.query.importFixedValue")}</option>
  </>;
  const busy = progress !== null;
  const updateMapping = (column: string, sourceIndex: number) => setMapping((current) => ({ ...current, [column]: sourceIndex }));
  const updatePolicy = (column: string, kind: EmptyCellPolicy["kind"] | "inherit") => setOverrides((current) => ({
    ...current, [column]: kind === "inherit" ? undefined : { kind, value: current[column]?.value },
  }));
  const updateFixedValue = (column: string, value: string) => setOverrides((current) => ({
    ...current, [column]: { kind: "value", value },
  }));
  const execute = async () => {
    if (controller.current || issues.length || !plan.columns.length) return;
    const abort = new AbortController();
    controller.current = abort;
    setError(null);
    setCancelling(false);
    setProgress({ phase: "preparing", completed: 0, total: dataRows.length });
    try {
      const outcome = await executeFileImport(target, plan, abort.signal, setProgress);
      setCompleted(outcome);
      onImported();
    } catch (failure) {
      setError(failure instanceof DOMException && failure.name === "AbortError"
        ? t("app.query.importCancelled") : formatErrorMessage(failure, t("app.query.importFailed")));
    } finally { controller.current = null; setProgress(null); setCancelling(false); }
  };
  const percent = progress && progress.total ? Math.floor(progress.completed / progress.total * 100) : 0;

  return <div className="query-result-update-dialog__backdrop" role="presentation">
    <section className="query-result-update-dialog query-result-file-import" role="dialog" aria-modal="true" aria-labelledby="query-import-title" aria-busy={busy}>
      <header className="query-result-update-dialog__header"><h2 id="query-import-title">{t("app.query.importPreviewTitle")}</h2><button type="button" className="query-result-update-dialog__close" disabled={busy} onClick={onCancel} aria-label={t("common.close")}>×</button></header>
      <div className="query-result-update-dialog__body">
        <p className="query-result-update-dialog__summary">{filename} · {dataRows.length.toLocaleString()} {t("app.query.importRowUnit")} → {[target.catalog, target.schema, target.table].filter(Boolean).join(".")}</p>
        {progress ? <div className="query-result-import__progress" role="status" aria-live="polite">
          <p>{t(progress.phase === "preparing" ? "app.query.importPreparing" : progress.phase === "validating" || progress.phase === "waiting" ? "app.query.importValidating" : progress.phase === "finishing" ? "app.query.importFinishing" : "app.query.importInserting")}</p>
          <div className="query-result-import__progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.completed}>
            <div className="query-result-import__progress-value" style={{ width: `${percent}%` }} />
          </div>
          <span>{progress.completed.toLocaleString()} / {progress.total.toLocaleString()} ({percent}%)</span>
          {cancelling ? <p>{t("app.query.importCancelling")}</p> : null}
        </div> : null}
        {completed ? <p role="status">{t("app.query.importCompleted").replace("{n}", completed.completed.toLocaleString())} {completed.pendingCommit ? t("app.query.importPendingCommit") : ""}</p> : <>
          <fieldset disabled={busy} className="query-result-file-import__options">
            {source.kind === "workbook" ? <label className="query-result-import__sheet-select">{t("app.query.importSheet")}<select value={sheetIndex} onChange={(event) => setSheetIndex(Number(event.target.value))}>{source.sheets.map((sheet, index) => <option key={index} value={index}>{sheet.name}</option>)}</select></label> : null}
            <div className="query-result-import__header-rows">
              <label>{t("app.query.importHeaderStartRow")}<input type="number" min="0" max={sourceRows.length} value={hasHeader ? start + 1 : 0} onChange={(event) => { const value = Number(event.target.value) - 1; setHeaderStartRow(value); if (headerEndRow < value) setHeaderEndRow(value); }} /></label>
              <label>{t("app.query.importHeaderEndRow")}<input type="number" min={start + 1} max={sourceRows.length} value={end + 1} disabled={!hasHeader || busy} onChange={(event) => setHeaderEndRow(Number(event.target.value) - 1)} /></label>
              <span>{t("app.query.importHeaderZero")}</span>
              <button type="button" className="query-result-update-dialog__button" onClick={() => setMapping(Object.fromEntries(targetColumns.map((column, index) => [column, index < columnCount ? index : -1])))}>{t("app.query.importMapByOrder")}</button>
            </div>
            <label className="query-result-import__truncate"><input type="checkbox" checked={clearExisting} onChange={(event) => setClearExisting(event.target.checked)} />{t("app.query.importTruncateExisting")}</label>
            <label className="query-result-import__sheet-select">{t("app.query.importEmptyDefault")}<select value={defaultEmpty.kind} onChange={(event) => setDefaultEmpty({ ...defaultEmpty, kind: event.target.value as EmptyCellPolicy["kind"] })}>{policyOptions}</select>{defaultEmpty.kind === "value" ? <input aria-label={t("app.query.importFixedValue")} value={defaultEmpty.value ?? ""} onChange={(event) => setDefaultEmpty({ ...defaultEmpty, value: event.target.value })} /> : null}</label>
            <div className="query-result-import__preview"><table className="query-result-file-import__mapping"><thead><tr><th>{t("app.query.importTargetColumn")}</th><th>{t("app.query.importSourceColumn")}</th><th>{t("app.query.importEmptyCount")}</th><th>{t("app.query.importEmptyPolicy")}</th></tr></thead><tbody>
              {targetColumns.map((column) => {
                const meta = target.columns.find((item) => item.name.toLowerCase() === column.toLowerCase());
                return <tr key={column}><td title={meta?.typeName}>{column} {meta?.nullable === false ? <small>{t("app.query.importNotNull")}</small> : meta?.nullable === true ? <small>{t("app.query.importNullable")}</small> : <small>{t("app.query.importNullabilityUnknown")}</small>}</td><td><select aria-label={`${column} ${t("app.query.importSourceColumn")}`} value={mapping[column] ?? -1} onChange={(event) => updateMapping(column, Number(event.currentTarget.value))}><option value={-1}>{t("app.query.importSkipColumn")}</option>{sourceHeaders.map((header, index) => <option key={index} value={index}>{header}</option>)}</select></td><td>{emptyCounts[column].toLocaleString()}</td><td><select aria-label={`${column} ${t("app.query.importEmptyPolicy")}`} value={overrides[column]?.kind ?? "inherit"} disabled={busy || mapping[column] < 0} onChange={(event) => updatePolicy(column, event.currentTarget.value as EmptyCellPolicy["kind"] | "inherit")}><option value="inherit">{t("app.query.importUseDefault")}</option>{policyOptions}</select>{overrides[column]?.kind === "value" ? <input aria-label={`${column} ${t("app.query.importFixedValue")}`} value={overrides[column]?.value ?? ""} onChange={(event) => updateFixedValue(column, event.currentTarget.value)} /> : null}</td></tr>;
              })}
            </tbody></table></div>
            <div className="query-result-import__preview"><table><thead><tr>{plan.columns.map((column) => <th key={column.name}>{column.name}</th>)}</tr></thead><tbody>{dataRows.slice(0, 6).map((row, index) => <tr key={index}>{plan.columns.map((column) => { const value = importCell(row[column.sourceIndex], column.empty); return <td key={column.name}>{value === null ? <em>NULL</em> : value === "" ? '""' : value}</td>; })}</tr>)}</tbody></table></div>
          </fieldset>
          {issues.length ? <div className="query-result-update-dialog__error" role="alert">{issues.map((issue) => <p key={`${issue.column}:${issue.reason}`}>{issue.column}: {t(issue.reason === "notNull" ? "app.query.importInvalidNull" : issue.reason === "number" ? "app.query.importInvalidNumber" : "app.query.importInvalidLength").replace("{n}", issue.count.toLocaleString()).replace("{row}", String(issue.firstFileRow))}</p>)}</div> : null}
          <p className="query-result-update-dialog__hint">{t("app.query.importPendingHint")}</p>
        </>}
        {error ? <p role="alert" className="query-result-update-dialog__error">{error}</p> : null}
      </div>
      <footer className="query-result-update-dialog__footer">{busy ? <button type="button" className="query-result-update-dialog__button" disabled={cancelling || progress?.phase === "finishing"} onClick={() => { setCancelling(true); controller.current?.abort(); }}>{t("common.cancel")}</button> : <><button type="button" className="query-result-update-dialog__button" onClick={onCancel}>{t("common.close")}</button>{!completed ? <button type="button" className="query-result-update-dialog__button query-result-update-dialog__button--primary" disabled={!dataRows.length || !plan.columns.length || issues.length > 0} onClick={() => void execute()}>{t("app.query.importRows").replace("{n}", dataRows.length.toLocaleString())}</button> : null}</>}</footer>
    </section>
  </div>;
}
