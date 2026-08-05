import { useEffect, useMemo, useState } from "react";
import { MenuRegistry } from "../../platform/actions/menuRegistry";
import { useI18n } from "../../platform/i18n/useI18n";
import { KeybindingsRegistry } from "../../platform/keybinding/keybindingRegistry";
import { resolveCommandDisplayLabel } from "../../services/commands/commandDisplayLabel";
import "./KeybindingsEditor.css";

type KeybindingRow = {
  commandId: string;
  label: string;
  keybinding: string;
};

function buildRows(): KeybindingRow[] {
  const menuTitles = MenuRegistry.collectCommandTitles();
  const rows: KeybindingRow[] = [];
  for (const entry of KeybindingsRegistry.getKeybindings()) {
    for (const keybinding of entry.labels) {
      rows.push({
        commandId: entry.commandId,
        label: resolveCommandDisplayLabel(entry.commandId, menuTitles),
        keybinding,
      });
    }
  }
  return rows.sort((a, b) => a.label.localeCompare(b.label));
}

function KeybindingsEditor() {
  const { t, locale } = useI18n();
  const [filter, setFilter] = useState("");
  const [rows, setRows] = useState(buildRows);

  useEffect(() => {
    setRows(buildRows());
  }, [locale]);

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
      aria-label={t("workbench.commands.keyboardShortcuts")}
    >
      <header className="keybindings-editor__header">
        <h1 className="keybindings-editor__title">
          {t("workbench.commands.keyboardShortcuts")}
        </h1>
        <p className="keybindings-editor__hint">
          {t("workbench.keybindings.hint")}
        </p>
        <label className="keybindings-editor__search">
          <span className="visually-hidden">
            {t("workbench.keybindings.searchAria")}
          </span>
          <input
            type="search"
            value={filter}
            spellCheck={false}
            autoComplete="off"
            placeholder={t("workbench.keybindings.searchPlaceholder")}
            aria-label={t("workbench.keybindings.searchAria")}
            onChange={(event) => setFilter(event.target.value)}
          />
        </label>
      </header>

      <div
        className="keybindings-editor__list"
        role="table"
        aria-label={t("workbench.keybindings.listAria")}
        aria-rowcount={filtered.length}
      >
        <div className="keybindings-editor__row keybindings-editor__row--head" role="row">
          <div role="columnheader">{t("workbench.keybindings.command")}</div>
          <div role="columnheader">{t("workbench.keybindings.keybinding")}</div>
          <div role="columnheader">{t("workbench.keybindings.commandId")}</div>
        </div>
        {filtered.length === 0 ? (
          <div className="keybindings-editor__empty" role="status">
            {t("workbench.keybindings.empty")}
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
