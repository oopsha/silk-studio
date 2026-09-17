import { useGridCellEditor, type CustomCellEditorProps } from "ag-grid-react";
import type { QueryResultRow } from "../../../services/query/queryResult";
import {
  CURRENT_TIMESTAMP_VALUE,
  isCurrentTimestampValue,
} from "../../../services/query/queryResultTemporalValue";
import {
  MaskedTemporalInput,
  isCompleteTemporalValue,
  type TemporalEditorKind,
} from "./MaskedTemporalInput";

type MaskedTemporalCellEditorProps = CustomCellEditorProps<QueryResultRow, string | null> & {
  editorKind: TemporalEditorKind;
};

/** AG Grid Community custom editor used for date/time columns during ordinary Enter editing. */
export default function MaskedTemporalCellEditor({
  value,
  onValueChange,
  editorKind,
}: MaskedTemporalCellEditorProps) {
  useGridCellEditor({
    isCancelAfterEnd: () => !isCurrentTimestampValue(value) && !isCompleteTemporalValue(value ?? "", editorKind),
  });

  return (
    <MaskedTemporalInput
      kind={editorKind}
      value={value === CURRENT_TIMESTAMP_VALUE ? "" : value ?? ""}
      autoFocus
      className="query-result-grid__temporal-cell-editor"
      onChange={(nextValue) => onValueChange(nextValue === "" ? null : nextValue)}
    />
  );
}
