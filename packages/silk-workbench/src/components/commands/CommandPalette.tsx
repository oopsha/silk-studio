import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useCloseOnAppBlur } from "@silk-studio/ui/hooks/useCloseOnAppBlur.ts";
import { CommandService } from "../../platform/commands/commandService";
import {
  filterCommandPaletteItems,
  listCommandPaletteItems,
  type CommandPaletteItem,
} from "../../services/commands/commandCatalog";
import { CommandPaletteService } from "../../services/commands/commandPaletteService";
import {
  placeOverSilkEditor,
  TITLEBAR_QUICK_PICK_CLASS,
} from "../../services/quickinput/titlebarQuickPickPlacement";
import { useI18n } from "../../platform/i18n/useI18n";
import "../layout/TitleBar/OpenEditorsQuickPick/OpenEditorsQuickPick.css";
import "./CommandPalette.css";

function CommandPalette() {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(() => CommandPaletteService.isOpen());
  const [filter, setFilter] = useState("");
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [placed, setPlaced] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return CommandPaletteService.onDidChange(() => {
      const next = CommandPaletteService.isOpen();
      setOpen(next);
      setPlaced(false);
      if (next) {
        setFilter("");
        setFocusedIndex(0);
      }
    });
  }, []);

  const items = useMemo(() => {
    if (!open) return [] as CommandPaletteItem[];
    return filterCommandPaletteItems(listCommandPaletteItems(), filter);
  }, [open, filter, locale]);

  useEffect(() => {
    setFocusedIndex((current) =>
      items.length === 0 ? 0 : Math.min(current, items.length - 1),
    );
  }, [items]);

  const close = useCallback(() => {
    CommandPaletteService.hide();
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      document.documentElement.classList.remove(TITLEBAR_QUICK_PICK_CLASS);
      return;
    }

    const el = rootRef.current;
    if (!el) return;

    const place = () => {
      if (placeOverSilkEditor(el)) setPlaced(true);
    };

    // Measure while silk-editor is visible, then hide it (Open Editors pattern).
    place();
    document.documentElement.classList.add(TITLEBAR_QUICK_PICK_CLASS);
    place();

    function handleResize() {
      place();
    }
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      document.documentElement.classList.remove(TITLEBAR_QUICK_PICK_CLASS);
    };
  }, [open, filter, focusedIndex, items.length]);

  useEffect(() => {
    if (!open) return;
    const frameId = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(frameId);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      close();
    }
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [open, close]);

  useCloseOnAppBlur(close, open);

  const accept = useCallback(
    async (item: CommandPaletteItem) => {
      close();
      if (item.id === "workbench.action.showCommands") return;
      try {
        await CommandService.executeCommand(item.id);
      } catch (error) {
        console.error("[commandPalette]", item.id, error);
      }
    },
    [close],
  );

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (items.length === 0) return;
      setFocusedIndex((index) => (index + 1) % items.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (items.length === 0) return;
      setFocusedIndex((index) => (index - 1 + items.length) % items.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const item = items[focusedIndex];
      if (item) void accept(item);
    }
  };

  if (!open) return null;

  return createPortal(
    <div
      ref={rootRef}
      className="quick-input-widget command-palette"
      role="dialog"
      aria-modal="true"
      aria-label={t("workbench.commandPalette.ariaLabel")}
      data-testid="command-palette"
      style={{
        position: "fixed",
        opacity: placed ? 1 : 0,
        pointerEvents: placed ? "auto" : "none",
      }}
    >
      <div className="quick-input-header">
        <div className="quick-input-filter">
          <input
            ref={inputRef}
            type="text"
            className="quick-input-box"
            value={filter}
            spellCheck={false}
            autoComplete="off"
            placeholder={t("workbench.commandPalette.placeholder")}
            aria-label={t("workbench.commandPalette.placeholder")}
            aria-controls="command-palette-list"
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={handleInputKeyDown}
          />
        </div>
      </div>

      <div
        id="command-palette-list"
        className="quick-input-list"
        role="listbox"
        aria-label={t("workbench.commandPalette.ariaLabel")}
      >
        {items.length === 0 ? (
          <div className="quick-input-list__empty">
            {t("workbench.commandPalette.empty")}
          </div>
        ) : (
          items.map((item, index) => {
            const isFocused = index === focusedIndex;
            return (
              <div
                key={item.id}
                className={`quick-input-list-row${isFocused ? " quick-input-list-row--focused" : ""}`}
                role="option"
                aria-selected={isFocused}
                onMouseEnter={() => setFocusedIndex(index)}
                onClick={() => void accept(item)}
              >
                <div className="quick-input-list-entry">
                  <span className="quick-input-list-label">{item.label}</span>
                  <span className="command-palette__id">{item.id}</span>
                  {item.keybinding ? (
                    <span className="command-palette__keybinding">
                      {item.keybinding}
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="command-palette__status" role="status" aria-live="polite">
        {items.length === 1
          ? t("workbench.commandPalette.statusOne")
          : t("workbench.commandPalette.statusMany").replace(
              "{n}",
              String(items.length),
            )}
      </div>
    </div>,
    document.body,
  );
}

export default CommandPalette;
