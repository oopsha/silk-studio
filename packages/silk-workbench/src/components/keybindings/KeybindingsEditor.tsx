import { useEffect, useMemo, useState } from "react";
import { MenuRegistry } from "../../platform/actions/menuRegistry";
import { KeybindingsRegistry } from "../../platform/keybinding/keybindingRegistry";
import "./KeybindingsEditor.css";

type KeybindingRow = {
  commandId: string;
  label: string;
  keybinding: string;
};

function fallbackLabel(commandId: string): string {
  const leaf = commandId.split(".").pop() ?? commandId;
  return leaf
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function buildRows(): KeybindingRow[] {
  const titles = MenuRegistry.collectCommandTitles();
  const rows: KeybindingRow[] = [];
  for (const entry of KeybindingsRegistry.getKeybindings()) {
    for (const keybinding of entry.labels) {
      rows.push({
        commandId: entry.commandId,
        label: titles.get(entry.commandId) ?? fallbackLabel(entry.commandId),
        keybinding,
      });
    }
  }
  return rows.sort((a, b) => a.label.localeCompare(b.label));
}

function KeybindingsEditor() {
  const [filter, setFilter] = useState("");
  const [rows, setRows] = useState(buildRows);

  useEffect(() => {
    setRows(buildRows());
  }, []);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (row) =>
        row.label.toLowerCase().includes(q) ||
        row.commandId.toLowerCase().includes(q) ||
        row.keybinding.toLowerCase().includes(q),
    );
  }, [rows, filter]);

  return (
    <main
      className="keybindings-editor"
      data-testid="keybindings-editor"
      aria-label="Keyboard Shortcuts"
    >
      <header className="keybindings-editor__header">
        <h1 className="keybindings-editor__title">Keyboard Shortcuts</h1>
        <p className="keybindings-editor__hint">
          Read-only list of registered bindings. Search by command or key.
        </p>
        <label className="keybindings-editor__search">
          <span className="visually-hidden">Search keyboard shortcuts</span>
          <input
            type="search"
            value={filter}
            spellCheck={false}
            autoComplete="off"
            placeholder="Search shortcuts…"
            aria-label="Search keyboard shortcuts"
            onChange={(event) => setFilter(event.target.value)}
          />
        </label>
      </header>

      <div
        className="keybindings-editor__list"
        role="table"
        aria-label="Registered keyboard shortcuts"
        aria-rowcount={filtered.length}
      >
        <div className="keybindings-editor__row keybindings-editor__row--head" role="row">
          <div role="columnheader">Command</div>
          <div role="columnheader">Keybinding</div>
          <div role="columnheader">Command ID</div>
        </div>
        {filtered.length === 0 ? (
          <div className="keybindings-editor__empty" role="status">
            No matching shortcuts
          </div>
        ) : (
          filtered.map((row) => (
            <div
              key={`${row.commandId}:${row.keybinding}`}
              className="keybindings-editor__row"
              role="row"
            >
              <div role="cell">{row.label}</div>
              <div role="cell" className="keybindings-editor__keys">
                {row.keybinding}
              </div>
              <div role="cell" className="keybindings-editor__id">
                {row.commandId}
              </div>
            </div>
          ))
        )}
      </div>
    </main>
  );
}

export default KeybindingsEditor;
