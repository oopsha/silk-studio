import { useState } from "react";
import type { ICellRendererParams } from "ag-grid-community";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { useConfiguration } from "@silk-studio/workbench/platform/configuration/useConfiguration.ts";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import { classifyColumnSize } from "../../services/connection/tableColumnTypeFormat";
import type { EditableColumnDraft } from "../../services/connection/tableStructureDiff";
import ColumnTypeGridEditor from "./ColumnTypeGridEditor";
import ColumnGrid, { type ColumnGridColumn } from "./ColumnGrid";
import type { TableStructureEditorState } from "./useTableStructureEditorState";
import "./TableStructureEditor.css";

type Props = { state: TableStructureEditorState };

function TableStructureEditor({ state }: Props) {
  const { t } = useI18n();
  const configuration = useConfiguration();
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const isSqlite = state.driverId === "sqlite";
  const showComment = !isSqlite || configuration["experimental.sqliteComments.enabled"];
  const rows = state.editedColumns;
  const canEdit = (row: EditableColumnDraft) =>
    !state.blockedReason && !row.readOnlyReason && !state.pendingDeleteRowIds.has(row.rowId);
  const editText = (field: "name" | "defaultValue" | "comment", readOnly = false) => ({
    enabled: (row: EditableColumnDraft) => canEdit(row) && !readOnly && !(isSqlite && row.origin && field === "defaultValue"),
    value: (row: EditableColumnDraft) => row[field] ?? "",
    apply: (row: EditableColumnDraft, value: unknown) =>
      state.updateColumn(row.rowId, { [field]: field !== "name" && String(value ?? "") === "" ? null : String(value ?? "") }),
  });
  const columns: ColumnGridColumn<EditableColumnDraft>[] = [
    { field: "name", title: t("app.columns.name"), width: 190, value: (row) => row.name, edit: editText("name") },
    { field: "pk", title: t("app.columns.primaryKeyOrder"), width: 90,
      value: (row) => String(state.primaryKeyOrders.get(row.name.toLowerCase()) ?? "") },
    { field: "typeName", title: t("app.columns.type"), width: 180, value: (row) => row.typeName,
      edit: {
        enabled: (row) => canEdit(row) && !(isSqlite && row.origin !== null),
        value: (row) => row.typeName,
        apply: (row, value) => state.updateColumn(row.rowId, { typeName: String(value ?? "") }),
        editor: ColumnTypeGridEditor,
        editorParams: { driverId: state.driverId, placeholder: t("app.tableStructure.selectType") },
      } },
  ];
  if (!isSqlite) {
    columns.push({ field: "length", title: t("app.tableStructure.length"), width: 85,
      value: (row) => String(row.length ?? ""),
      edit: {
        enabled: (row) => canEdit(row) && classifyColumnSize(row.typeName) !== "unsized",
        value: (row) => row.length ?? null,
        apply: (row, value) => state.updateColumn(row.rowId, { length: value === "" || value == null ? undefined : Number(value) }),
        editor: "agNumberCellEditor",
      } });
    columns.push({ field: "scale", title: t("app.tableStructure.scale"), width: 85,
      value: (row) => String(row.scale ?? ""),
      edit: {
        enabled: (row) => canEdit(row) && classifyColumnSize(row.typeName) === "sized-numeric",
        value: (row) => row.scale ?? null,
        apply: (row, value) => state.updateColumn(row.rowId, { scale: value === "" || value == null ? undefined : Number(value) }),
        editor: "agNumberCellEditor",
      } });
  }
  columns.push({ field: "nullable", title: t("app.columns.nullable"), width: 90,
    value: (row) => isSqlite && row.origin ? row.nullable ? "NULL" : "NOT NULL" :
      row.nullable ? t("app.columns.yes") : t("app.columns.no"),
    edit: {
      enabled: (row) => canEdit(row) && !(isSqlite && row.origin !== null),
      value: (row) => row.nullable ? t("app.columns.yes") : t("app.columns.no"),
      apply: (row, value) => state.updateColumn(row.rowId, { nullable: value === t("app.columns.yes") }),
      editor: "agSelectCellEditor",
      editorParams: { values: [t("app.columns.yes"), t("app.columns.no")] },
    } });
  columns.push({ field: "defaultValue", title: t("app.columns.defaultValue"), width: 160,
    value: (row) => row.defaultValue ?? "", edit: editText("defaultValue") });
  if (showComment) columns.push({ field: "comment", title: t("app.columns.comment"), width: 220,
    value: (row) => row.comment ?? "", edit: editText("comment", isSqlite) });
  columns.push({ field: "action", title: "", width: 90, value: () => "",
    render: (params: ICellRendererParams<EditableColumnDraft>) => {
      const row = params.data;
      return row && !state.blockedReason && !row.readOnlyReason ?
        <button type="button" className="table-structure-editor__row-action" onClick={() => state.toggleDrop(row)}>
          <Codicon name={state.pendingDeleteRowIds.has(row.rowId) ? "discard" : "trash"} />
          {state.pendingDeleteRowIds.has(row.rowId) ? t("app.tableStructure.undoDrop") : t("app.tableStructure.dropColumn")}
        </button> : null;
    } });

  if (state.status === "loading") return <div className="table-structure-editor__status">{t("app.columns.loading")}</div>;
  if (state.status === "error") return <div className="table-structure-editor__status table-structure-editor__status--error">{state.errorMessage}</div>;

  return <ColumnGrid rows={rows} columns={columns} filename="table-columns" onFocusedRow={(row) => setSelectedRowId(row.rowId)}
    rowClassRules={{ "table-structure-editor__row--pending-drop": (params) => !!params.data && state.pendingDeleteRowIds.has(params.data.rowId) }} actions={<>
    <button title={t("app.tableStructure.addColumn")} aria-label={t("app.tableStructure.addColumn")}
      disabled={!!state.blockedReason} onClick={state.addColumn}><Codicon name="add" /></button>
    <button title={t("app.tableStructure.duplicateColumn")} aria-label={t("app.tableStructure.duplicateColumn")} disabled={!!state.blockedReason || !selectedRowId}
      onClick={() => { const row = rows.find((item) => item.rowId === selectedRowId); if (row) state.duplicateColumn(row); }}><Codicon name="files" /></button>
  </>} />;
}

export default TableStructureEditor;
