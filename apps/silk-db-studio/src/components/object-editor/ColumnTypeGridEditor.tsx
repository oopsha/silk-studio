import ColumnTypeCombobox from "./ColumnTypeCombobox";
import type { ConnectionDriverId } from "../../services/connection/connectionTypes";

type Props = {
  value: string | null | undefined;
  onValueChange: (value: string) => void;
  stopEditing: () => void;
  driverId: ConnectionDriverId;
  placeholder: string;
};

export default function ColumnTypeGridEditor({ value, onValueChange, stopEditing, driverId, placeholder }: Props) {
  return <ColumnTypeCombobox driverId={driverId} value={value ?? ""} placeholder={placeholder} autoFocus
    onChange={(next) => { onValueChange(next); window.setTimeout(() => stopEditing(), 0); }} />;
}
