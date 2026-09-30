import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import type { ParsedImportSource } from "../../../services/query/queryResultImport";

type Props = {
  filename: string;
  targetColumns: string[];
  source: ParsedImportSource;
  onCancel: () => void;
  onImport: (rows: Array<Record<string, string | null>>) => void;
};

function defaultMapping(headers: string[], targetColumns: string[], hasHeader: boolean): Record<string, number> {
  return Object.fromEntries(targetColumns.map((column, index) => [
    column,
    hasHeader
      ? headers.findIndex((header) => header.trim().toLowerCase() === column.toLowerCase())
      : index < headers.length ? index : -1,
  ]));
}

export default function QueryResultImportDialog({ filename, targetColumns, source, onCancel, onImport }: Props) {
  const { t } = useI18n();
  const [hasHeader, setHasHeader] = useState(true);
  const [sheetIndex, setSheetIndex] = useState(() => source.kind === "workbook"
    ? Math.max(0, source.sheets.findIndex((sheet) => sheet.rows.length > 0))
    : 0);
  const sourceRows = source.kind === "workbook"
    ? source.sheets[sheetIndex]?.rows ?? []
    : source.parsed.rows;
  const sourceHeaders = useMemo(() => {
    const first = sourceRows[0] ?? [];
    return hasHeader ? first : first.map((_, index) => `Column ${index + 1}`);
  }, [hasHeader, sourceRows]);
  const dataRows = hasHeader ? sourceRows.slice(1) : sourceRows;
  const [mapping, setMapping] = useState<Record<string, number>>(() => defaultMapping(sourceRows[0] ?? [], targetColumns, true));
  useEffect(() => {
    setMapping(defaultMapping(sourceRows[0] ?? [], targetColumns, hasHeader));
  }, [sourceRows, targetColumns, hasHeader]);
  const mappedColumns = targetColumns.filter((column) => mapping[column] >= 0);
  const previewRows = dataRows.slice(0, 6);
  const imported = () => dataRows.map((row) => Object.fromEntries(targetColumns.map((column) => {
    const value = mapping[column] >= 0 ? row[mapping[column]] ?? "" : "";
    return [column, value === "" ? null : value];
  })));

  return <div className="query-result-update-dialog__backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
    <section className="query-result-update-dialog" role="dialog" aria-modal="true" aria-labelledby="query-import-title">
      <header className="query-result-update-dialog__header"><h2 id="query-import-title">{t("app.query.importPreviewTitle")}</h2><button type="button" className="query-result-update-dialog__close" onClick={onCancel} aria-label={t("app.query.cancelChanges")}><span aria-hidden="true">×</span></button></header>
      <div className="query-result-update-dialog__body">
        <p className="query-result-update-dialog__summary">{filename} · {dataRows.length.toLocaleString()} rows · {source.kind === "workbook" ? "Excel" : source.parsed.delimiter === "\t" ? "TAB" : source.parsed.delimiter}</p>
        {source.kind === "workbook" ? <label className="query-result-import__sheet-select">{t("app.query.importSheet")}<select value={sheetIndex} onChange={(event) => setSheetIndex(Number(event.target.value))}>{source.sheets.map((sheet, index) => <option key={`${index}-${sheet.name}`} value={index}>{sheet.name}</option>)}</select></label> : null}
        <label className="query-result-import__header-toggle"><input type="checkbox" checked={hasHeader} onChange={(event) => setHasHeader(event.target.checked)} />{t("app.query.importFirstRowHeader")}</label>
        <div className="query-result-import__mapping">
          {targetColumns.map((column) => <label key={column}><span>{column}</span><select value={mapping[column] ?? -1} onChange={(event) => setMapping((current) => ({ ...current, [column]: Number(event.target.value) }))}><option value={-1}>{t("app.query.importSkipColumn")}</option>{sourceHeaders.map((header, index) => <option key={`${index}-${header}`} value={index}>{header}</option>)}</select></label>)}
        </div>
        <div className="query-result-import__preview"><table><thead><tr>{targetColumns.filter((column) => mapping[column] >= 0).map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{previewRows.map((row, rowIndex) => <tr key={rowIndex}>{targetColumns.filter((column) => mapping[column] >= 0).map((column) => <td key={column}>{row[mapping[column]]}</td>)}</tr>)}</tbody></table></div>
        <p className="query-result-update-dialog__hint">{t("app.query.importPendingHint").replace("{n}", String(dataRows.length))}</p>
      </div>
      <footer className="query-result-update-dialog__footer"><button type="button" className="query-result-update-dialog__button" onClick={onCancel}>{t("app.query.cancelChanges")}</button><button type="button" className="query-result-update-dialog__button query-result-update-dialog__button--primary" disabled={dataRows.length === 0 || mappedColumns.length === 0} onClick={() => onImport(imported())}>{t("app.query.importRows").replace("{n}", String(dataRows.length))}</button></footer>
    </section>
  </div>;
}
