import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import type { ParsedImportSource } from "../../../services/query/queryResultImport";

type Props = {
  filename: string;
  targetColumns: string[];
  source: ParsedImportSource;
  initialTruncate: boolean;
  onCancel: () => void;
  onImport: (rows: Array<Record<string, string | null>>, truncateExisting: boolean) => void;
};

function defaultMapping(headers: string[], targetColumns: string[], hasHeader: boolean): Record<string, number> {
  return Object.fromEntries(targetColumns.map((column, index) => [
    column,
    hasHeader
      ? headers.findIndex((header) => header.trim().toLowerCase() === column.toLowerCase())
      : index < headers.length ? index : -1,
  ]));
}

export default function QueryResultImportDialog({ filename, targetColumns, source, initialTruncate, onCancel, onImport }: Props) {
  const { t } = useI18n();
  const [headerStartRow, setHeaderStartRow] = useState(0);
  const [headerEndRow, setHeaderEndRow] = useState(0);
  const [truncateExisting, setTruncateExisting] = useState(initialTruncate);
  const [sheetIndex, setSheetIndex] = useState(() => source.kind === "workbook"
    ? Math.max(0, source.sheets.findIndex((sheet) => sheet.rows.length > 0))
    : 0);
  const sourceRows = source.kind === "workbook"
    ? source.sheets[sheetIndex]?.rows ?? []
    : source.parsed.rows;
  const columnCount = useMemo(() => Math.max(0, ...sourceRows.map((row) => row.length)), [sourceRows]);
  const hasHeader = sourceRows.length > 0 && headerStartRow >= 0;
  const normalizedHeaderStart = Math.min(Math.max(headerStartRow, 0), Math.max(0, sourceRows.length - 1));
  const normalizedHeaderEnd = Math.min(Math.max(headerEndRow, normalizedHeaderStart), Math.max(0, sourceRows.length - 1));
  const sourceHeaders = useMemo(() => Array.from({ length: columnCount }, (_, index) => {
    if (!hasHeader) return `Column ${index + 1}`;
    const parts = sourceRows.slice(normalizedHeaderStart, normalizedHeaderEnd + 1)
      .map((row) => row[index]?.trim() ?? "")
      .filter(Boolean)
      .filter((value, position, values) => values.indexOf(value) === position);
    return parts.join(" / ") || `Column ${index + 1}`;
  }), [columnCount, hasHeader, normalizedHeaderEnd, normalizedHeaderStart, sourceRows]);
  const dataRows = sourceRows.slice(hasHeader ? normalizedHeaderEnd + 1 : 0);
  const [mapping, setMapping] = useState<Record<string, number>>(() => defaultMapping(sourceHeaders, targetColumns, hasHeader));
  useEffect(() => {
    setMapping(defaultMapping(sourceHeaders, targetColumns, hasHeader));
  }, [sourceHeaders, targetColumns, hasHeader]);
  const mappedColumns = targetColumns.filter((column) => mapping[column] >= 0);
  const previewRows = dataRows.slice(0, 6);
  const imported = () => dataRows.map((row) => Object.fromEntries(targetColumns.map((column) => {
    const value = mapping[column] >= 0 ? row[mapping[column]] ?? "" : "";
    return [column, value === "" ? null : value];
  })));
  const mapByOrder = () => setMapping(Object.fromEntries(
    targetColumns.map((column, index) => [column, index < columnCount ? index : -1]),
  ));
  const rowOptions = sourceRows.map((_, index) => <option key={index} value={index}>{index + 1}</option>);

  return <div className="query-result-update-dialog__backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
    <section className="query-result-update-dialog" role="dialog" aria-modal="true" aria-labelledby="query-import-title">
      <header className="query-result-update-dialog__header"><h2 id="query-import-title">{t("app.query.importPreviewTitle")}</h2><button type="button" className="query-result-update-dialog__close" onClick={onCancel} aria-label={t("common.close")}><span aria-hidden="true">×</span></button></header>
      <div className="query-result-update-dialog__body">
        <p className="query-result-update-dialog__summary">{filename} · {t("app.query.rowsCount").replace("{n}", dataRows.length.toLocaleString())} · {source.kind === "workbook" ? "Excel" : source.parsed.delimiter === "\t" ? "TAB" : source.parsed.delimiter}</p>
        {source.kind === "workbook" ? <label className="query-result-import__sheet-select">{t("app.query.importSheet")}<select value={sheetIndex} onChange={(event) => setSheetIndex(Number(event.target.value))}>{source.sheets.map((sheet, index) => <option key={`${index}-${sheet.name}`} value={index}>{sheet.name}</option>)}</select></label> : null}
        <div className="query-result-import__header-rows">
          <label>{t("app.query.importHeaderStartRow")}<select value={hasHeader ? normalizedHeaderStart : -1} onChange={(event) => {
            const value = Number(event.target.value);
            setHeaderStartRow(value);
            if (value >= 0 && headerEndRow < value) setHeaderEndRow(value);
          }}><option value={-1}>{t("app.query.importNoHeader")}</option>{rowOptions}</select></label>
          <label>{t("app.query.importHeaderEndRow")}<select value={hasHeader ? normalizedHeaderEnd : -1} disabled={!hasHeader} onChange={(event) => setHeaderEndRow(Number(event.target.value))}>{rowOptions.map((_, index) => <option key={index} value={index} disabled={index < normalizedHeaderStart}>{index + 1}</option>)}</select></label>
          <button type="button" className="query-result-update-dialog__button" onClick={mapByOrder}>{t("app.query.importMapByOrder")}</button>
        </div>
        <label className="query-result-import__truncate"><input type="checkbox" checked={truncateExisting} onChange={(event) => setTruncateExisting(event.target.checked)} />{t("app.query.importTruncateExisting")}</label>
        <div className="query-result-import__mapping">
          {targetColumns.map((column) => <label key={column}><span>{column}</span><select value={mapping[column] ?? -1} onChange={(event) => setMapping((current) => ({ ...current, [column]: Number(event.target.value) }))}><option value={-1}>{t("app.query.importSkipColumn")}</option>{sourceHeaders.map((header, index) => <option key={`${index}-${header}`} value={index}>{header}</option>)}</select></label>)}
        </div>
        <div className="query-result-import__preview"><table><thead><tr>{targetColumns.filter((column) => mapping[column] >= 0).map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{previewRows.map((row, rowIndex) => <tr key={rowIndex}>{targetColumns.filter((column) => mapping[column] >= 0).map((column) => <td key={column}>{row[mapping[column]]}</td>)}</tr>)}</tbody></table></div>
        <p className="query-result-update-dialog__hint">{t("app.query.importPendingHint").replace("{n}", String(dataRows.length))}</p>
      </div>
      <footer className="query-result-update-dialog__footer"><button type="button" className="query-result-update-dialog__button" onClick={onCancel}>{t("common.close")}</button><button type="button" className="query-result-update-dialog__button query-result-update-dialog__button--primary" disabled={dataRows.length === 0 || mappedColumns.length === 0} onClick={() => onImport(imported(), truncateExisting)}>{t("app.query.importRows").replace("{n}", String(dataRows.length))}</button></footer>
    </section>
  </div>;
}
