import { useEffect, useMemo, useState } from "react";
import type { ConnectionDriverId } from "../../services/connection/connectionTypes";
import { columnTypeOptionsWithCurrentValue } from "../../services/connection/tableColumnTypeOptions";
import "./ColumnTypeCombobox.css";

type ColumnTypeComboboxProps = {
  driverId: ConnectionDriverId;
  value: string;
  disabled?: boolean;
  placeholder: string;
  onChange: (value: string) => void;
};

/** Keyboard-searchable type picker (typeahead combobox), shared by table editors. */
function ColumnTypeCombobox({ driverId, value, disabled, placeholder, onChange }: ColumnTypeComboboxProps) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const options = useMemo(() => columnTypeOptionsWithCurrentValue(driverId, value), [driverId, value]);
  useEffect(() => setQuery(value), [value]);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized ? options.filter((option) => option.toLowerCase().includes(normalized)) : options;
  }, [options, query]);

  const select = (option: string) => {
    setQuery(option);
    onChange(option);
    setOpen(false);
  };

  return (
    <div className="column-type-combobox">
      <input
        className="table-structure-editor__cell-input"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        value={query}
        disabled={disabled}
        placeholder={placeholder}
        onFocus={() => { setOpen(true); setActiveIndex(0); }}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); setActiveIndex(0); }}
        onBlur={() => window.setTimeout(() => {
          const exact = options.find((option) => option.toLowerCase() === query.trim().toLowerCase());
          if (exact) select(exact);
          else setQuery(value);
          setOpen(false);
        }, 120)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); setActiveIndex((index) => Math.min(index + 1, Math.max(filtered.length - 1, 0))); }
          else if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => Math.max(index - 1, 0)); }
          else if (event.key === "Enter" && open && filtered[activeIndex]) { event.preventDefault(); select(filtered[activeIndex]); }
          else if (event.key === "Escape") setOpen(false);
        }}
      />
      {open && !disabled ? (
        <div className="column-type-combobox__menu" role="listbox">
          {filtered.length > 0 ? filtered.map((option, index) => (
            <button key={option} type="button" role="option" aria-selected={option === value} className={`column-type-combobox__option${index === activeIndex ? " column-type-combobox__option--active" : ""}`} onMouseDown={(event) => { event.preventDefault(); select(option); }}>
              {option}
            </button>
          )) : <div className="column-type-combobox__empty">일치하는 타입이 없습니다.</div>}
        </div>
      ) : null}
    </div>
  );
}

export default ColumnTypeCombobox;
