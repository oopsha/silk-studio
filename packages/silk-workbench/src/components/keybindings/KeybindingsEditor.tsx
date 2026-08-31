import { useEffect, useMemo, useRef, useState } from "react";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { MenuRegistry } from "../../platform/actions/menuRegistry";
import { useI18n } from "../../platform/i18n/useI18n";
import { KeybindingsRegistry } from "../../platform/keybinding/keybindingRegistry";
import { UserKeybindingsService } from "../../platform/keybinding/userKeybindingsService";
import { formatKeyChord, keyboardEventToChord } from "../../platform/keybinding/keybindingLabels";
import { resolveCommandDisplayLabel } from "../../services/commands/commandDisplayLabel";
import "./KeybindingsEditor.css";

type KeybindingRow = {
  commandId: string;
  label: string;
  keybinding: string;
  overridden: boolean;
};

const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta"]);

function buildRows(): KeybindingRow[] {
  const menuTitles = MenuRegistry.collectCommandTitles();
  const rows: KeybindingRow[] = [];
  for (const entry of KeybindingsRegistry.getKeybindings()) {
    for (const keybinding of entry.labels) {
      rows.push({
        commandId: entry.commandId,
        label: resolveCommandDisplayLabel(entry.commandId, menuTitles),
        keybinding,
        overridden: UserKeybindingsService.isOverridden(entry.commandId),
      });
    }
  }
  return rows.sort((a, b) => a.label.localeCompare(b.label));
}

/** Every command currently bound to `label`, other than `exceptCommandId` — for the inline
 *  "already used by …" conflict hint while capturing a new key. */
function findConflicts(label: string, exceptCommandId: string): string[] {
  const owners: string[] = [];
  for (const entry of KeybindingsRegistry.getKeybindings()) {
    if (entry.commandId === exceptCommandId) continue;
    if (entry.labels.includes(label)) owners.push(entry.commandId);
  }
  return owners;
}

function KeybindingsEditor() {
  const { t, locale } = useI18n();
  const [filter, setFilter] = useState("");
  const [rows, setRows] = useState(buildRows);
  const [editing, setEditing] = useState<{ commandId: string; keybinding: string } | null>(null);
  const [captured, setCaptured] = useState<string | null>(null);
  const captureRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setRows(buildRows());
    return KeybindingsRegistry.onDidChange(() => setRows(buildRows()));
  }, [locale]);

  useEffect(() => {
    if (editing) captureRef.current?.focus();
  }, [editing]);

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

  const menuTitles = useMemo(() => MenuRegistry.collectCommandTitles(), [locale]);

  function startEdit(row: KeybindingRow) {
    setEditing({ commandId: row.commandId, keybinding: row.keybinding });
    setCaptured(null);
  }

  function cancelEdit() {
    setEditing(null);
    setCaptured(null);
  }

  function commitEdit(newLabel: string) {
    if (!editing) return;
    const current = KeybindingsRegistry.getKeybindings().find(
      (entry) => entry.commandId === editing.commandId,
    );
    const keys = (current?.labels ?? []).map((key) =>
      key === editing.keybinding ? newLabel : key,
    );
    UserKeybindingsService.setKeybinding(editing.commandId, keys);
    cancelEdit();
  }

  function resetCommand(commandId: string) {
    UserKeybindingsService.resetKeybinding(commandId);
  }

  function handleCaptureKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      cancelEdit();
      return;
    }
    if (MODIFIER_KEYS.has(event.key)) return;
    const chord = keyboardEventToChord(event.nativeEvent);
    setCaptured(formatKeyChord(chord));
  }

  const conflicts = editing && captured ? findConflicts(captured, editing.commandId) : [];

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
          <div role="columnheader">{t("workbench.keybindings.actions")}</div>
        </div>
        {filtered.length === 0 ? (
          <div className="keybindings-editor__empty" role="status">
            {t("workbench.keybindings.empty")}
          </div>
        ) : (
          filtered.map((row) => {
            const isEditing =
              editing?.commandId === row.commandId &&
              editing.keybinding === row.keybinding;
            return (
              <div
                key={`${row.commandId}:${row.keybinding}`}
                className="keybindings-editor__row"
                role="row"
              >
                <div role="cell">
                  {row.label}
                  {row.overridden ? (
                    <span className="keybindings-editor__badge">
                      {t("workbench.keybindings.changedBadge")}
                    </span>
                  ) : null}
                </div>
                <div role="cell" className="keybindings-editor__keys">
                  {isEditing ? (
                    <div
                      ref={captureRef}
                      className="keybindings-editor__capture"
                      data-keybinding-capture
                      tabIndex={0}
                      role="textbox"
                      aria-label={t("workbench.keybindings.capturePrompt")}
                      onKeyDown={handleCaptureKeyDown}
                      onBlur={cancelEdit}
                    >
                      {captured ?? t("workbench.keybindings.capturePrompt")}
                    </div>
                  ) : (
                    row.keybinding
                  )}
                </div>
                <div role="cell" className="keybindings-editor__id">
                  {row.commandId}
                </div>
                <div role="cell" className="keybindings-editor__actions">
                  {isEditing ? (
                    <>
                      <button
                        type="button"
                        className="keybindings-editor__action keybindings-editor__action--confirm"
                        disabled={!captured}
                        title={t("workbench.keybindings.confirm")}
                        aria-label={t("workbench.keybindings.confirm")}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => captured && commitEdit(captured)}
                      >
                        <Codicon name="check" />
                      </button>
                      <button
                        type="button"
                        className="keybindings-editor__action"
                        title={t("common.cancel")}
                        aria-label={t("common.cancel")}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={cancelEdit}
                      >
                        <Codicon name="close" />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="keybindings-editor__action"
                        title={t("workbench.keybindings.change")}
                        aria-label={t("workbench.keybindings.change")}
                        onClick={() => startEdit(row)}
                      >
                        <Codicon name="edit" />
                      </button>
                      {row.overridden ? (
                        <button
                          type="button"
                          className="keybindings-editor__action"
                          title={t("workbench.keybindings.reset")}
                          aria-label={t("workbench.keybindings.reset")}
                          onClick={() => resetCommand(row.commandId)}
                        >
                          <Codicon name="discard" />
                        </button>
                      ) : null}
                    </>
                  )}
                </div>
                {isEditing && conflicts.length > 0 ? (
                  <div className="keybindings-editor__conflict" role="alert">
                    {t("workbench.keybindings.conflictWarning").replace(
                      "{label}",
                      conflicts
                        .map((id) => resolveCommandDisplayLabel(id, menuTitles))
                        .join(", "),
                    )}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </main>
  );
}

export default KeybindingsEditor;
