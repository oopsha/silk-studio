import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import { classifyColumnSize } from "../../services/connection/tableColumnTypeFormat";
import { columnTypeOptionsWithCurrentValue } from "../../services/connection/tableColumnTypeOptions";
import type { TableStructureEditorState } from "./useTableStructureEditorState";
import "./TableStructureEditor.css";

type TableStructureEditorProps = {
  state: TableStructureEditorState;
};

/**
 * The Columns tab's editable grid. Table name/comment and Save/Discard/Refresh live in
 * `ObjectEditorHeader` instead (they act on the table as a whole, not just this grid — see
 * `useTableStructureEditorState`'s doc comment) — this component only owns what's meaningless
 * outside the grid itself: adding a row and editing/dropping individual columns.
 */
function TableStructureEditor({ state }: TableStructureEditorProps) {
  const { t } = useI18n();

  if (state.status === "loading") {
    return <div className="table-structure-editor__status">{t("app.columns.loading")}</div>;
  }

  if (state.status === "error") {
    return (
      <div className="table-structure-editor__status table-structure-editor__status--error">
        {state.errorMessage}
      </div>
    );
  }

  return (
    <div className="table-structure-editor">
      <div className="table-structure-editor__toolbar">
        <div className="table-structure-editor__toolbar-spacer" />
        <button
          type="button"
          className="table-structure-editor__toolbar-button"
          disabled={!!state.blockedReason}
          onClick={state.addColumn}
        >
          <Codicon name="add" />
          {t("app.tableStructure.addColumn")}
        </button>
      </div>

      <div className="table-structure-editor__grid">
        <table className="table-structure-editor__table">
          <thead>
            <tr>
              <th className="table-structure-editor__index-cell">#</th>
              <th>{t("app.columns.name")}</th>
              <th className="table-structure-editor__pk-cell">{t("app.columns.primaryKey")}</th>
              <th>{t("app.columns.type")}</th>
              <th>{t("app.tableStructure.length")}</th>
              <th>{t("app.tableStructure.scale")}</th>
              <th>{t("app.columns.nullable")}</th>
              <th>{t("app.columns.defaultValue")}</th>
              <th>{t("app.columns.comment")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {state.editedColumns.map((draft, index) => {
              const sizeClass = classifyColumnSize(draft.typeName);
              const isReadOnly = !!draft.readOnlyReason || !!state.blockedReason;
              const isPendingDrop = state.pendingDeleteRowIds.has(draft.rowId);
              return (
                <tr
                  key={draft.rowId}
                  className={
                    isPendingDrop ? "table-structure-editor__row--pending-drop" : undefined
                  }
                >
                  <td className="table-structure-editor__index-cell">{index + 1}</td>
                  <td>
                    <input
                      className="table-structure-editor__cell-input"
                      value={draft.name}
                      disabled={isReadOnly || isPendingDrop}
                      onChange={(e) => state.updateColumn(draft.rowId, { name: e.target.value })}
                    />
                  </td>
                  <td className="table-structure-editor__pk-cell">
                    {state.primaryKeyNames.has(draft.name.toLowerCase()) ? "✓" : ""}
                  </td>
                  <td>
                    <select
                      className="table-structure-editor__cell-input"
                      value={draft.typeName}
                      disabled={isReadOnly || isPendingDrop}
                      onChange={(e) =>
                        state.updateColumn(draft.rowId, { typeName: e.target.value })
                      }
                    >
                      {!draft.typeName ? (
                        <option value="" disabled>
                          {t("app.tableStructure.selectType")}
                        </option>
                      ) : null}
                      {columnTypeOptionsWithCurrentValue(state.driverId, draft.typeName).map(
                        (option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ),
                      )}
                    </select>
                  </td>
                  <td>
                    <input
                      className="table-structure-editor__cell-input table-structure-editor__cell-input--narrow"
                      type="number"
                      value={draft.length ?? ""}
                      disabled={isReadOnly || isPendingDrop || sizeClass === "unsized"}
                      onChange={(e) =>
                        state.updateColumn(draft.rowId, {
                          length: e.target.value === "" ? undefined : Number(e.target.value),
                        })
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="table-structure-editor__cell-input table-structure-editor__cell-input--narrow"
                      type="number"
                      value={draft.scale ?? ""}
                      disabled={isReadOnly || isPendingDrop || sizeClass !== "sized-numeric"}
                      onChange={(e) =>
                        state.updateColumn(draft.rowId, {
                          scale: e.target.value === "" ? undefined : Number(e.target.value),
                        })
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={draft.nullable}
                      disabled={isReadOnly || isPendingDrop}
                      onChange={(e) =>
                        state.updateColumn(draft.rowId, { nullable: e.target.checked })
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="table-structure-editor__cell-input"
                      value={draft.defaultValue ?? ""}
                      disabled={isReadOnly || isPendingDrop}
                      onChange={(e) =>
                        state.updateColumn(draft.rowId, {
                          defaultValue: e.target.value === "" ? null : e.target.value,
                        })
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="table-structure-editor__cell-input"
                      value={draft.comment ?? ""}
                      disabled={isReadOnly || isPendingDrop}
                      onChange={(e) =>
                        state.updateColumn(draft.rowId, {
                          comment: e.target.value === "" ? null : e.target.value,
                        })
                      }
                    />
                  </td>
                  <td>
                    {!state.blockedReason && !draft.readOnlyReason ? (
                      <button
                        type="button"
                        className="table-structure-editor__row-action"
                        onClick={() => state.toggleDrop(draft)}
                      >
                        <Codicon name={isPendingDrop ? "discard" : "trash"} />
                        {isPendingDrop
                          ? t("app.tableStructure.undoDrop")
                          : t("app.tableStructure.dropColumn")}
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default TableStructureEditor;
